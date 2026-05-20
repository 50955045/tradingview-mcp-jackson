export class Notifier {
  constructor(config = {}) {
    this.config = config;
    this.channels = [];

    if (config.console?.enabled) {
      this.channels.push(this.consoleNotify.bind(this));
    }

    if (config.telegram?.enabled) {
      this.channels.push(this.telegramNotify.bind(this));
    }

    if (config.webhook?.enabled) {
      this.channels.push(this.webhookNotify.bind(this));
    }

    if (config.email?.enabled) {
      this.channels.push(this.emailNotify.bind(this));
    }

    if (config.dingtalk?.enabled) {
      this.channels.push(this.dingtalkNotify.bind(this));
    }

    if (this.channels.length === 0) {
      this.channels.push(this.consoleNotify.bind(this));
      console.warn('No notification channels enabled, falling back to console');
    }
  }

  async consoleNotify(message) {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}] ${message}`);
  }

  async telegramNotify(message) {
    const { botToken, chatId } = this.config.telegram;
    if (!botToken || !chatId) {
      console.warn('Telegram botToken or chatId not configured');
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown'
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.status}`);
      }
    } catch (e) {
      console.warn('Failed to send Telegram notification:', e.message);
    }
  }

  async webhookNotify(message) {
    const { url, method = 'POST', headers = {} } = this.config.webhook;
    if (!url) {
      console.warn('Webhook URL not configured');
      return;
    }

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          message,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
      }
    } catch (e) {
      console.warn('Failed to send webhook notification:', e.message);
    }
  }

  async emailNotify(message) {
    const { smtpHost, smtpPort, smtpUser, smtpPass, from, to } = this.config.email;
    if (!smtpHost || !from || !to) {
      console.warn('Email configuration incomplete');
      return;
    }

    console.warn('Email notification requires nodemailer. Install it with: npm install nodemailer');
    console.warn('Email would be sent to:', to);
    console.warn('Email content:', message);
  }

  async dingtalkNotify(message) {
    const { webhookUrl, secret } = this.config.dingtalk;
    if (!webhookUrl) {
      console.warn('DingTalk webhook URL not configured');
      return;
    }

    try {
      let url = webhookUrl;
      if (secret) {
        const timestamp = Date.now();
        const sign = await this.dingtalkSign(secret, timestamp);
        url += `&timestamp=${timestamp}&sign=${sign}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'text',
          text: { content: message }
        })
      });

      if (!response.ok) {
        throw new Error(`DingTalk API error: ${response.status}`);
      }
    } catch (e) {
      console.warn('Failed to send DingTalk notification:', e.message);
    }
  }

  async dingtalkSign(secret, timestamp) {
    const crypto = await import('crypto');
    const stringToSign = `${timestamp}\n${secret}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(stringToSign);
    return encodeURIComponent(hmac.digest('base64'));
  }

  async send(message) {
    const promises = this.channels.map(channel => channel(message));
    await Promise.allSettled(promises);
  }
}
