import type { Tx } from '../../../generated/bnbsmartchain'
import type { TransactionParserArgs } from '../../parser'
import { BaseTransactionParser } from '../../parser'
import * as zrx from '../../parser/zrx'
import * as bep20 from './bep20'

export const ZRX_BSC_PROXY_CONTRACT = '0xDef1C0ded9bec7F1a1670819833240f027b25EfF'

export class TransactionParser extends BaseTransactionParser<Tx> {
  constructor(args: TransactionParserArgs) {
    super(args)

    this.registerParsers([
      new bep20.Parser({ chainId: this.chainId, provider: this.provider }),
      new zrx.Parser({ proxyContract: ZRX_BSC_PROXY_CONTRACT }),
    ])
  }
}
