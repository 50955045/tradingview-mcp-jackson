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
  indicatorHistory: {}
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

function getIndicatorValue(studyValues, indicatorName, fieldName) {
  const study = studyValues.find(s => s.name.toLowerCase().includes(indicatorName.toLowerCase()));
  if (!study) return undefined;
  return study.values[fieldName];
}

async function checkSingleIndicatorAlert(symbol, alert, studyValues) {
  const alertKey = `${symbol}-indicator-${alert.name}`;
  const now = Date.now();
  const cooldown = alert.cooldown || 300000;

  if (state.lastAlerts[alertKey] && now - state.lastAlerts[alertKey] < cooldown) {
    return null;
  }

  const value = getIndicatorValue(studyValues, alert.indicator, alert.field);
  if (value === undefined) return null;

  let triggered = false;
  let message = '';

  if (!state.indicatorHistory[alertKey]) {
    state.indicatorHistory[alertKey] = [];
  }
  state.indicatorHistory[alertKey].push(value);
  if (state.indicatorHistory[alertKey].length > 10) {
    state.indicatorHistory[alertKey].shift();
  }

  const history = state.indicatorHistory[alertKey];
  const prevValue = history.length >= 2 ? history[history.length - 2] : null;

  switch (alert.condition) {
    case 'above':
      if (value >= alert.threshold) {
        triggered = true;
        message = `📊 [${symbol}] ${alert.indicator} ${alert.field} = ${value} 超过阈值 ${alert.threshold}`;
      }
      break;
    case 'below':
      if (value <= alert.threshold) {
        triggered = true;
        message = `📊 [${symbol}] ${alert.indicator} ${alert.field} = ${value} 低于阈值 ${alert.threshold}`;
      }
      break;
    case 'cross_above':
      if (prevValue !== null && prevValue < alert.threshold && value >= alert.threshold) {
        triggered = true;
        message = `📊 [${symbol}] ${alert.indicator} ${alert.field} 向上突破 ${alert.threshold} (当前: ${value})`;
      }
      break;
    case 'cross_below':
      if (prevValue !== null && prevValue > alert.threshold && value <= alert.threshold) {
        triggered = true;
        message = `📊 [${symbol}] ${alert.indicator} ${alert.field} 向下跌破 ${alert.threshold} (当前: ${value})`;
      }
      break;
    case 'rising':
      if (prevValue !== null && value > prevValue) {
        triggered = true;
        message = `📈 [${symbol}] ${alert.indicator} ${alert.field} 正在上升 (${prevValue} → ${value})`;
      }
      break;
    case 'falling':
      if (prevValue !== null && value < prevValue) {
        triggered = true;
        message = `📉 [${symbol}] ${alert.indicator} ${alert.field} 正在下降 (${prevValue} → ${value})`;
      }
      break;
    case 'between':
      if (value >= alert.min && value <= alert.max) {
        triggered = true;
        message = `📊 [${symbol}] ${alert.indicator} ${alert.field} = ${value} 在区间 [${alert.min}, ${alert.max}] 内`;
      }
      break;
    case 'outside':
      if (value < alert.min || value > alert.max) {
        triggered = true;
        message = `⚠️ [${symbol}] ${alert.indicator} ${alert.field} = ${value} 超出区间 [${alert.min}, ${alert.max}]`;
      }
      break;
  }

  if (triggered) {
    state.lastAlerts[alertKey] = now;
    return { message };
  }

  return null;
}

async function checkCrossIndicatorAlert(symbol, alert, studyValues) {
  const alertKey = `${symbol}-cross-${alert.name}`;
  const now = Date.now();
  const cooldown = alert.cooldown || 300000;

  if (state.lastAlerts[alertKey] && now - state.lastAlerts[alertKey] < cooldown) {
    return null;
  }

  const value1 = getIndicatorValue(studyValues, alert.indicator1, alert.field1);
  const value2 = getIndicatorValue(studyValues, alert.indicator2, alert.field2);
  if (value1 === undefined || value2 === undefined) return null;

  if (!state.indicatorHistory[alertKey]) {
    state.indicatorHistory[alertKey] = [];
  }
  state.indicatorHistory[alertKey].push({ value1, value2 });
  if (state.indicatorHistory[alertKey].length > 10) {
    state.indicatorHistory[alertKey].shift();
  }

  const history = state.indicatorHistory[alertKey];
  const prev = history.length >= 2 ? history[history.length - 2] : null;

  let triggered = false;
  let message = '';

  switch (alert.condition) {
    case 'cross_above':
      if (prev && prev.value1 <= prev.value2 && value1 > value2) {
        triggered = true;
        message = `🔺 [${symbol}] ${alert.indicator1} ${alert.field1} (${value1}) 上穿 ${alert.indicator2} ${alert.field2} (${value2})`;
      }
      break;
    case 'cross_below':
      if (prev && prev.value1 >= prev.value2 && value1 < value2) {
        triggered = true;
        message = `🔻 [${symbol}] ${alert.indicator1} ${alert.field1} (${value1}) 下穿 ${alert.indicator2} ${alert.field2} (${value2})`;
      }
      break;
    case 'above':
      if (value1 > value2) {
        triggered = true;
        message = `📊 [${symbol}] ${alert.indicator1} ${alert.field1} (${value1}) 高于 ${alert.indicator2} ${alert.field2} (${value2})`;
      }
      break;
    case 'below':
      if (value1 < value2) {
        triggered = true;
        message = `📊 [${symbol}] ${alert.indicator1} ${alert.field1} (${value1}) 低于 ${alert.indicator2} ${alert.field2} (${value2})`;
      }
      break;
  }

  if (triggered) {
    state.lastAlerts[alertKey] = now;
    return { message };
  }

  return null;
}

async function checkMultiConditionAlert(symbol, alert, studyValues) {
  const alertKey = `${symbol}-multi-${alert.name}`;
  const now = Date.now();
  const cooldown = alert.cooldown || 300000;

  if (state.lastAlerts[alertKey] && now - state.lastAlerts[alertKey] < cooldown) {
    return null;
  }

  const conditions = alert.conditions || [];
  const results = [];

  for (const cond of conditions) {
    const value = getIndicatorValue(studyValues, cond.indicator, cond.field);
    if (value === undefined) {
      return null;
    }

    let condMet = false;
    switch (cond.condition) {
      case 'above':
        condMet = value >= cond.threshold;
        break;
      case 'below':
        condMet = value <= cond.threshold;
        break;
      case 'between':
        condMet = value >= cond.min && value <= cond.max;
        break;
    }
    results.push({ met: condMet, value, cond });
  }

  const logic = alert.logic || 'all';
  let triggered = false;

  if (logic === 'all') {
    triggered = results.every(r => r.met);
  } else if (logic === 'any') {
    triggered = results.some(r => r.met);
  }

  if (triggered) {
    const condSummary = results.map(r => 
      `${r.cond.indicator}.${r.cond.field}=${r.value}(${r.met ? '✓' : '✗'})`
    ).join(', ');
    state.lastAlerts[alertKey] = now;
    return { 
      message: `🎯 [${symbol}] 多条件${logic === 'all' ? '全部' : '任一'}满足: ${condSummary}` 
    };
  }

  return null;
}

async function checkIndicatorAlerts(symbol) {
  const notifications = [];

  try {
    const studyValues = await data.getStudyValues();
    if (!studyValues) return notifications;

    const singleAlerts = config.indicatorAlerts?.[symbol] || [];
    for (const alert of singleAlerts) {
      const result = await checkSingleIndicatorAlert(symbol, alert, studyValues);
      if (result) {
        notifications.push(result);
      }
    }

    const crossAlerts = config.crossIndicatorAlerts?.[symbol] || [];
    for (const alert of crossAlerts) {
      const result = await checkCrossIndicatorAlert(symbol, alert, studyValues);
      if (result) {
        notifications.push(result);
      }
    }

    const multiAlerts = config.multiConditionAlerts?.[symbol] || [];
    for (const alert of multiAlerts) {
      const result = await checkMultiConditionAlert(symbol, alert, studyValues);
      if (result) {
        notifications.push(result);
      }
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

  console.log('🚀 指标监控已启动');
  console.log(`📋 监控标的: ${config.watchlist.join(', ')}`);
  console.log(`⏱️ 检查间隔: ${config.interval || 60} 秒`);
  console.log('📊 专注于技术指标监控 (价格监控已禁用)');

  await monitorOnce();

  const intervalMs = (config.interval || 60) * 1000;
  monitorInterval = setInterval(monitorOnce, intervalMs);
}

export async function stop() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('🛑 指标监控已停止');
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
