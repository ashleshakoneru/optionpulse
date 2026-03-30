exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    // Read keys from environment variables (set in Netlify dashboard)
    const alpacaKey    = process.env.ALPACA_KEY;
    const alpacaSecret = process.env.ALPACA_SECRET;

    if (!alpacaKey || !alpacaSecret) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Alpaca keys not configured in Netlify environment variables' }) };
    }

    const { symbols } = JSON.parse(event.body || '{}');
    if (!symbols) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing symbols' }) };

    const syms = symbols.join(',');
    const ah = { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSecret };

    // Latest trades
    const tradeRes  = await fetch(`https://data.alpaca.markets/v2/stocks/trades/latest?symbols=${syms}&feed=iex`, { headers: ah });
    if (!tradeRes.ok) throw new Error(`Trades API: ${tradeRes.status}`);
    const tradeData = await tradeRes.json();

    // Daily bars - 35 days
    const d35 = new Date(); d35.setDate(d35.getDate() - 35);
    const barRes  = await fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${syms}&timeframe=1Day&start=${d35.toISOString().split('T')[0]}&limit=35&feed=iex`, { headers: ah });
    const barData = barRes.ok ? await barRes.json() : { bars: {} };

    const result = {};
    for (const sym of symbols) {
      const trade = tradeData?.trades?.[sym];
      const bars  = barData?.bars?.[sym] || [];
      const price = trade?.p || (bars.length ? bars[bars.length-1].c : 0);
      const prev  = bars.length > 1 ? bars[bars.length-2].c : price;
      result[sym] = { price, prevClose: prev, bars: bars.slice(-35) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
