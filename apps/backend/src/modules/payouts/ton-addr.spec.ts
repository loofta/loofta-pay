import { Address } from '@ton/core';
import { tonDepositAddressFields } from './payouts.service';

describe('tonDepositAddressFields', () => {
  const eq = 'EQAcJPWu_L--FEzd4wbxAyUo6oCPHmG1NmDTgX_MgAL_hvBF';

  it('converts gram_ton EQ address to non-bounceable UQ, same account', () => {
    const out = tonDepositAddressFields('gram_ton', eq);
    expect(out.deposit_address.startsWith('UQ')).toBe(true);
    expect(out.deposit_address_raw).toMatch(/^0:[0-9a-f]{64}$/);
    expect(Address.parse(out.deposit_address).equals(Address.parse(eq))).toBe(true);
  });

  it('leaves other funding sources and unparseable input untouched', () => {
    expect(tonDepositAddressFields('usdc_base', '0xabc')).toEqual({ deposit_address: '0xabc' });
    expect(tonDepositAddressFields('gram_ton', 'garbage')).toEqual({ deposit_address: 'garbage' });
  });
});
