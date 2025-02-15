import { createSlice } from '@reduxjs/toolkit'
import { createApi } from '@reduxjs/toolkit/query/react'
import type { AccountId } from '@shapeshiftoss/caip'
import { fromAccountId } from '@shapeshiftoss/caip'
import cloneDeep from 'lodash/cloneDeep'
import { PURGE } from 'redux-persist'
import { getChainAdapterManager } from 'context/PluginProvider/chainAdapterSingleton'
import { logger } from 'lib/logger'
import { getMixPanel } from 'lib/mixpanel/mixPanelSingleton'
import { MixPanelEvents } from 'lib/mixpanel/types'
import { BASE_RTK_CREATE_API_CONFIG } from 'state/apis/const'
import type { ReduxState } from 'state/reducer'

import type { AccountMetadataById, Portfolio, WalletId } from './portfolioSliceCommon'
import { initialState } from './portfolioSliceCommon'
import { accountToPortfolio } from './utils'

const moduleLogger = logger.child({ namespace: ['portfolioSlice'] })

type WalletMetaPayload = {
  walletId?: WalletId | undefined
  walletName?: string | undefined
}

export const portfolio = createSlice({
  name: 'portfolio',
  initialState,
  reducers: {
    clear: () => {
      moduleLogger.info('clearing portfolio')
      return initialState
    },
    setWalletMeta: (state, { payload }: { payload: WalletMetaPayload }) => {
      const { walletId, walletName } = payload
      // don't fire and rerender with same action
      if (state.walletId === walletId) return
      // note this function can unset the walletId to undefined
      if (walletId) {
        moduleLogger.info(payload, 'setting wallet id and name')
        const data = { 'Wallet Id': walletId, 'Wallet Name': walletName }
        // if we already have state.walletId, we're switching wallets, otherwise connecting
        getMixPanel()?.track(
          state.walletId ? MixPanelEvents.SwitchWallet : MixPanelEvents.ConnectWallet,
          data,
        )
        state.walletId = walletId
        state.walletName = walletName
        state.wallet.ids = Array.from(new Set([...state.wallet.ids, walletId])).filter(Boolean)
      } else {
        moduleLogger.info(payload, 'unsetting wallet id and name')
        state.walletId = undefined
        state.walletName = undefined
        getMixPanel()?.track(MixPanelEvents.DisconnectWallet)
      }
    },
    upsertAccountMetadata: (state, { payload }: { payload: AccountMetadataById }) => {
      moduleLogger.debug('upserting account metadata')
      state.accountMetadata.byId = {
        ...state.accountMetadata.byId,
        ...payload,
      }

      state.accountMetadata.ids = Object.keys(state.accountMetadata.byId)

      if (!state.walletId) return // realistically, at this point, we should have a walletId set
      const existingWalletAccountIds = state.wallet.byId[state.walletId] ?? []
      const newWalletAccountIds = Object.keys(payload)
      // keep an index of what account ids belong to this wallet
      state.wallet.byId[state.walletId] = Array.from(
        new Set([...existingWalletAccountIds, ...newWalletAccountIds]),
      )
    },
    upsertPortfolio: (state, { payload }: { payload: Portfolio }) => {
      moduleLogger.debug('upserting portfolio')
      // upsert all
      state.accounts.byId = { ...state.accounts.byId, ...payload.accounts.byId }
      const accountIds = Array.from(new Set([...state.accounts.ids, ...payload.accounts.ids]))
      state.accounts.ids = accountIds

      state.accountBalances.byId = {
        ...state.accountBalances.byId,
        ...payload.accountBalances.byId,
      }
      const accountBalanceIds = Array.from(
        new Set([...state.accountBalances.ids, ...payload.accountBalances.ids]),
      )
      state.accountBalances.ids = accountBalanceIds
    },
  },
  extraReducers: builder => builder.addCase(PURGE, () => initialState),
})

type GetAccountArgs = {
  accountId: AccountId
  upsertOnFetch?: boolean
}

export const portfolioApi = createApi({
  ...BASE_RTK_CREATE_API_CONFIG,
  reducerPath: 'portfolioApi',
  endpoints: build => ({
    getAccount: build.query<Portfolio, GetAccountArgs>({
      queryFn: async ({ accountId, upsertOnFetch }, { dispatch, getState }) => {
        if (!accountId) return { data: cloneDeep(initialState) }
        // 0xdef1cafe: be careful with this, RTK query can't type this correctly
        const untypedState = getState()
        const assetIds = (untypedState as ReduxState).assets.ids
        const chainAdapters = getChainAdapterManager()
        const { chainId, account: pubkey } = fromAccountId(accountId)
        try {
          const adapter = chainAdapters.get(chainId)
          if (!adapter) throw new Error(`no adapter for ${chainId} not available`)
          const portfolioAccounts = { [pubkey]: await adapter.getAccount(pubkey) }
          const data = accountToPortfolio({ portfolioAccounts, assetIds })
          upsertOnFetch && dispatch(portfolio.actions.upsertPortfolio(data))
          return { data }
        } catch (e) {
          moduleLogger.error(e, `error fetching account ${accountId}`)
          const data = cloneDeep(initialState)
          data.accounts.ids.push(accountId)
          data.accounts.byId[accountId] = { assetIds: [] }
          dispatch(portfolio.actions.upsertPortfolio(data))
          return { data }
        }
      },
    }),
  }),
})
