exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const alpacaKey    = process.env.ALPACA_KEY;
    const alpacaSecret = process.env.ALPACA_SECRET;

    if (!alpacaKey || !alpacaSecret) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Alpaca keys not configured' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { symbols, optionsChain, ticker, expiration } = body;

    const ah = {
      'APCA-API-KEY-ID': alpacaKey,
      'APCA-API-SECRET-KEY': alpacaSecret
    };

    // ── Options Chain Request ──
    if (optionsChain && ticker) {
      try {
        // Get next 3 Friday expirations
        const expirations = getNextExpirations(3);
        const expDate = expiration || expirations[0];

        // Fetch options snapshot for ticker
        const optRes = await fetch(
          `https://data.alpaca.markets/v1beta1/options/snapshots/${ticker}?expiration_date=${expDate}&feed=indicative&limit=50`,
          { headers: ah }
        );

        if (!optRes.ok) {
          const errText = await optRes.text();
          return { statusCode: 200, headers, body: JSON.stringify({ options: [], error: `Options API: ${optRes.status} - ${errText}` }) };
        }

        const optData = await optRes.json();
        const snapshots = optData.snapshots || {};

        // Parse and organize options data
        const calls = [];
        const puts  = [];

        for (const [symbol, snap] of Object.entries(snapshots)) {
          const greeks   = snap.greeks || {};
          const quote    = snap.latestQuote || {};
          const trade    = snap.latestTrade || {};
          const details  = snap.details || {};

          const item = {
            symbol,
            strike:       details.strikePrice || 0,
            expiry:       details.expirationDate || expDate,
            type:         details.optionType || 'call',
            bid:          quote.bp || 0,
            ask:          quote.ap || 0,
            mark:         ((quote.bp || 0) + (quote.ap || 0)) / 2,
            last:         trade.p || 0,
            volume:       snap.dailyBar?.v || 0,
            openInterest: snap.openInterest || 0,
            iv:           snap.impliedVolatility ? (snap.impliedVolatility * 100).toFixed(1) : null,
            delta:        greeks.delta ? greeks.delta.toFixed(4) : null,
            theta:        greeks.theta ? greeks.theta.toFixed(4) : null,
            gamma:        greeks.gamma ? greeks.gamma.toFixed(4) : null,
            vega:         greeks.vega  ? greeks.vega.toFixed(4)  : null,
          };

          if (details.optionType === 'call') calls.push(item);
          else puts.push(item);
        }

        // Sort by strike
        calls.sort((a,b) => a.strike - b.strike);
        puts.sort((a,b)  => a.strike - b.strike);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ options: { calls, puts }, expirations, ticker })
        };

      } catch(e) {
        return { statusCode: 200, headers, body: JSON.stringify({ options: [], error: e.message }) };
      }
    }

    // ── Stock Prices Request ──
    if (!symbols) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing symbols' }) };

    const syms = symbols.join(',');

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

function getNextExpirations(count) {
  const dates = [];
  const d = new Date();
  d.setHours(0,0,0,0);
  let checked = 0;
  while (dates.length < count && checked < 60) {
    d.setDate(d.getDate() + 1);
    checked++;
    if (d.getDay() === 5) { // Friday
      dates.push(d.toISOString().split('T')[0]);
    }
  }
  return dates;
}
