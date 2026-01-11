const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('miraDesktop', {
  version: '0.0.1',
  env: {
    START_URL: process.env.MIRA_DESKTOP_URL || null
  }
});

