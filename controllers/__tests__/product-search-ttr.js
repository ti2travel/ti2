const bookings = require('../bookings');

describe('resolveProductSearchTtrSeconds', () => {
  const oneDay = bookings.oneDayProductSearchTtrSeconds;
  const weekly = bookings.defaultProductSearchTtrSeconds;

  it('uses a seven-day default when no TTR is configured', () => {
    expect(bookings.resolveProductSearchTtrSeconds({}, {})).toBe(weekly);
    expect(weekly).toBe(oneDay * 7);
  });

  it('keeps an explicit one-day token TTR', () => {
    expect(bookings.resolveProductSearchTtrSeconds({
      ttlForProducts: oneDay,
    }, {})).toBe(oneDay);
    expect(bookings.resolveProductSearchTtrSeconds({
      ttlForProducts: String(oneDay),
    }, {})).toBe(String(oneDay));
  });

  it('keeps an explicit non-legacy TTR, including short test values', () => {
    expect(bookings.resolveProductSearchTtrSeconds({
      ttlForProducts: 2,
    }, {})).toBe(2);
    expect(bookings.resolveProductSearchTtrSeconds({
      ttlForProducts: oneDay * 2,
    }, {})).toBe(oneDay * 2);
  });

  it('keeps an explicit one-day plugin cacheSettings TTR', () => {
    expect(bookings.resolveProductSearchTtrSeconds({}, {
      cacheSettings: {
        bookingsProductSearch: {
          ttr: oneDay,
        },
      },
    })).toBe(oneDay);
  });
});
