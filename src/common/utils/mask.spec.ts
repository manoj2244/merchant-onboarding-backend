import { maskEmail, maskName, maskPhone, maskTaxId, redactSensitive } from './mask';

describe('masking', () => {
  it('keeps only the last 4 characters of a tax id', () => {
    expect(maskTaxId('TEST-000-1234')).toBe('****1234');
  });

  it('never reveals more than a third of a short identifier', () => {
    expect(maskTaxId('AB')).toBe('****');
    expect(maskTaxId('ABCD')).toBe('****D');
    expect(maskTaxId('AB-CD')).toBe('****D');
    expect(maskTaxId('ABCDEF')).toBe('****EF');
    expect(maskTaxId('ABCDEFG')).toBe('****FG');
    expect(maskTaxId('A1B2C3D4E5')).toBe('****D4E5');
  });

  it('keeps only the last 4 digits of a phone number', () => {
    expect(maskPhone('+15550101234')).toBe('****1234');
  });

  it('masks the local part of an email', () => {
    expect(maskEmail('jane.owner@example.com')).toBe('j***@example.com');
    expect(maskEmail('invalid')).toBe('***');
  });

  it('reduces a name to initials', () => {
    expect(maskName('Jane  Example Owner')).toBe('J. E. O.');
  });

  describe('redactSensitive', () => {
    it('removes secrets and masks PII at any depth, case-insensitively', () => {
      const input = {
        password: 'p',
        Authorization: 'Bearer abc',
        nested: { accessToken: 't', ownerTaxId: 'TEST-000-1234', list: [{ OwnerEmail: 'jane@example.com' }] },
        before: { ownerPhone: '+15550101234', ownerFullName: 'Jane Example' },
        businessName: 'Example Coffee',
        amount: 10,
      };

      expect(redactSensitive(input)).toEqual({
        password: '[REDACTED]',
        Authorization: '[REDACTED]',
        nested: { accessToken: '[REDACTED]', ownerTaxId: '****1234', list: [{ OwnerEmail: 'j***@example.com' }] },
        before: { ownerPhone: '****1234', ownerFullName: 'J. E.' },
        businessName: 'Example Coffee',
        amount: 10,
      });
    });

    it('does not mutate its input', () => {
      const input = { ownerTaxId: 'TEST-000-1234' };
      redactSensitive(input);
      expect(input.ownerTaxId).toBe('TEST-000-1234');
    });

    it('passes through null and primitives', () => {
      expect(redactSensitive(null)).toBeNull();
      expect(redactSensitive({ website: null })).toEqual({ website: null });
    });
  });
});
