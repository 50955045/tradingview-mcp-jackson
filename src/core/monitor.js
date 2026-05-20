import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { chart, data, health } from './index.js';
import { Notifier } from './notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '../../monitor.config.json');
const STATE_PATH = join(__dirname, '../../.monitor-state.json');

let monitorInterval = null;
let notifier = null;
let config = null;
let state = {
  lastAlerts: {},
  lastPriceCheck: {}
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('monitor.config.json not found. Please create one from monitor.config.example.json');
  }
  const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
  config = JSON.parse(configContent);
  return config;
}

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    try {
      const stateContent = fs.readFileSync(STATE_PATH, 'utf8');
      state = { ...state, ...JSON.parse(stateContent) };
    } catch (e) {
      console.warn('Failed to load state, using default');
    }
  }
}

function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function checkPriceAlerts(symbol, currentPrice) {
  const alerts = config.priceAlerts?.[symbol] || [];
  const notifications = [];

  for (const alert of alerts) {
    const alertKey = `${symbol}-${alert.type}-${alert.price}`;
    const now = Date.now();
    const cooldown = alert.cooldown || 300000;

    if (state.lastAlerts[alertKey] && now - state.lastAlerts[alertKey] < cooldown) {
      continue;
    }

    let triggered = false;
    let message = '';

    switch (alert.type) {
      case 'above':
        if (currentPrice >= alert.price) {
          triggered = true;
          message = `🚀 ${symbol} 价格突破 ${alert.price}! 当前价格: ${currentPrice}`;
        }
        break;
      case 'below':
        if (currentPrice <= alert.price) {
          triggered = true;
          message = `📉 ${symbol} 价格跌破 ${alert.price}! 当前价格: ${currentPrice}`;
        }
        break;
      case 'cross_above':
        const prevAbove = state.lastPriceCheck[symbol]?.above ?? false;
        if (!prevAbove && currentPrice >= alert.price) {
          triggered = true;
          message = `🔺 ${symbol} 向上突破 ${alert.price}! 当前价格: ${currentPrice}`;
        }
        state.lastPriceCheck[symbol] = { ...state.lastPriceCheck[symbol], above: currentPrice >= alert.price };
        break;
      case 'cross_below':
        const prevBelow = state.lastPriceCheck[symbol]?.below ?? true;
        if (prevBelow && currentPrice <= alert.price) {
          triggered = true;
          message = `🔻 ${symbol} 向下跌破 ${alert.price}! 当前价格: ${currentPrice}`;
        }
        state.lastPriceCheck[symbol] = { ...state.lastPriceCheck[symbol], below: currentPrice <= alert.price };
        break;
    }

    if (triggered) {
      notifications.push({ symbol, alert, message });
      state.lastAlerts[alertKey] = now;
    }
  }

  return notifications;
}

async function checkIndicatorAlerts(symbol) {
  const alerts = config.indicatorAlerts?.[symbol] || [];
  const notifications = [];

  try {
    const studyValues = await data.getStudyValues();
    if (!studyValues) return notifications;

    for (const alert of alerts) {
      const alertKey = `${symbol}-indicator-${alert.name}`;
      const now = Date.now();
      const cooldown = alert.cooldown || 300000;

      if (state.lastAlerts[alertKey] && now - state.lastAlerts[alertKey] < cooldown) {
        continue;
      }

      const study = studyValues.find(s => s.name.toLowerCase().includes(alert.indicator.toLowerCase()));
      if (!study) continue;

      const value = study.values[alert.field];
      if (value === undefined) continue;

      let triggered = false;
      let message = '';

      switch (alert.condition) {
        case 'above':
          if (value >= alert.threshold) {
            triggered = true;
            message = `📊 ${symbol} ${alert.indicator} ${alert.field} = ${value} 超过 ${alert.threshold}`;
          }
          break;
        case 'below':
          if (value <= alert.threshold) {
            triggered = true;
            message = `📊 ${symbol} ${alert.indicator} ${alert.field} = ${value} 低于 ${alert.threshold}`;
          }
          break;
        case 'cross_above':
          const prevIndAbove = state.lastPriceCheck[alertKey]?.value ?? Infinity;
          if (prevIndAbove < alert.threshold && value >= alert.threshold) {
            triggered = true;
            message = `📊 ${symbol} ${alert.indicator} ${alert.field} 向上突破 ${alert.threshold} (当前: ${value})`;
          }
          break;
        case 'cross_below':
          const prevIndBelow = state.lastPriceCheck[alertKey]?.value ?? -Infinity;
          if (prevIndBelow > alert.threshold && value <= alert.threshold) {
            triggered = true;
            message = `📊 ${symbol} ${alert.indicator} ${alert.field} 向下跌破 ${alert.threshold} (当前: ${value})`;
          }
          break;
      }

      if (triggered) {
        notifications.push({ symbol, alert, message });
        state.lastAlerts[alertKey] = now;
      }

      state.lastPriceCheck[alertKey] = { value };
    }
  } catch (e) {
    console.warn(`Failed to check indicators for ${symbol}:`, e.message);
  }

  return notifications;
}

async function monitorOnce() {
  const notifications = [];

  for (const symbol of config.watchlist) {
    try {
      await chart.setSymbol(symbol);
      await chart.setTimeframe(config.defaultTimeframe || '60');

      const quote = await data.getQuote();
      if (!quote) continue;

      const priceNotifications = await checkPriceAlerts(symbol, quote.close);
      notifications.push(...priceNotifications);

      const indicatorNotifications = await checkIndicatorAlerts(symbol);
      notifications.push(...indicatorNotifications);

    } catch (e) {
      console.warn(`Failed to monitor ${symbol}:`, e.message);
    }
  }

  for (const notification of notifications) {
    await notifier.send(notification.message);
  }

  saveState();
}

export async function start() {
  loadConfig();
  loadState();
  notifier = new Notifier(config.notifications);

  const healthResult = await health.check();
  if (!healthResult.cdp_connected) {
    throw new Error('TradingView not connected. Please start it with debug mode.');
  }

  console.log('🚀 Monitor started');
  console.log(`📋 Watching: ${config.watchlist.join(', ')}`);
  console.log(`⏱️  Interval: ${config.interval || 60} seconds`);

  await monitorOnce();

  const intervalMs = (config.interval || 60) * 1000;
  monitorInterval = setInterval(monitorOnce, intervalMs);
}

export async function stop() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('🛑 Monitor stopped');
  }
}

export async function status() {
  return {
    running: monitorInterval !== null,
    config: config ? {
      watchlist: config.watchlist,
      interval: config.interval || 60,
      notificationChannels: Object.keys(config.notifications || {}).filter(k => config.notifications[k]?.enabled)
    } : null
  };
}
