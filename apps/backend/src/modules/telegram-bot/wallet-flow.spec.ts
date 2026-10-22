import { validateAddress, isValidSolanaAddress, shortAddress, withdrawAmountRows, parseTokenQuery, formatTokenAmount } from './wallet-flow';

describe('validateAddress', () => {
  it('accepts well formed addresses for each network and refuses the rest', () => {
    expect(validateAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'solana')).toBe(true);
    expect(validateAddress('0x' + 'a'.repeat(40), 'base')).toBe(true);
    expect(validateAddress('0x' + 'a'.repeat(39), 'base')).toBe(false);
    expect(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'bitcoin')).toBe(true);
    expect(validateAddress('TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH', 'tron')).toBe(true);
    expect(validateAddress('alice.near', 'near')).toBe(true);
  });
  it('a Solana address typed for an EVM network (or the other way round) is refused', () => {
    expect(validateAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'base')).toBe(false);
    expect(validateAddress('0x' + 'a'.repeat(40), 'solana')).toBe(false);
  });
  it('refuses empty text and unknown networks instead of guessing', () => {
    expect(validateAddress('', 'solana')).toBe(false);
    expect(validateAddress('something long enough to look real', 'unknownchain')).toBe(false);
    expect(isValidSolanaAddress('not an address')).toBe(false);
  });
});

describe('wallet flow helpers', () => {
  it('shortens an address for a button or a line', () => {
    expect(shortAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe('9WzD…AWWM');
    expect(shortAddress('abc')).toBe('abc');
  });
  it('only offers preset amounts that fit the balance, plus Max and Custom', () => {
    const labels = (b: number) => withdrawAmountRows(b).flat().map((x) => x.text);
    expect(labels(60)).toEqual(['$10', '$25', '$50', 'Max $60', 'Custom amount', 'Cancel']);
    expect(labels(5)).toEqual(['Max $5', 'Custom amount', 'Cancel']);
    expect(labels(0.5)).toEqual(['Custom amount', 'Cancel']);
  });
  it('reads a token typed by hand', () => {
    expect(parseTokenQuery('arb on arbitrum')).toEqual({ symbol: 'ARB', chain: 'arbitrum' });
    expect(parseTokenQuery('USDT tron')).toEqual({ symbol: 'USDT', chain: 'tron' });
    expect(parseTokenQuery('BTC')).toEqual({ symbol: 'BTC', chain: undefined });
    expect(parseTokenQuery('hello there how are you')).toBeNull();
  });
  it('formats token amounts without scientific notation', () => {
    expect(formatTokenAmount(0.00001234)).toBe('0.000012');
    expect(formatTokenAmount(1234.5678)).toBe('1234.57');
    expect(formatTokenAmount(2.5)).toBe('2.5');
  });
});
