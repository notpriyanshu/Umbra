// Narrow, typed bridge. The renderer never gets Node, fs, or raw API keys.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => {
  const fn = (_e, d) => cb(d);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('umbra', {
  win: { minimize: invoke('win:minimize'), maximize: invoke('win:maximize'), close: invoke('win:close'), onState: on('win:state') },
  app: { info: invoke('app:info') },
  fs: {
    openFolder: invoke('fs:openFolder'), restore: invoke('fs:restore'), closeFolder: invoke('fs:closeFolder'),
    readDir: invoke('fs:readDir'), tree: invoke('fs:tree'), readFile: invoke('fs:readFile'), writeFile: invoke('fs:writeFile'),
    create: invoke('fs:create'), rename: invoke('fs:rename'), delete: invoke('fs:delete'), reveal: invoke('fs:reveal'),
    search: invoke('fs:search'), allFiles: invoke('fs:allFiles')
  },
  settings: { get: invoke('settings:get'), set: invoke('settings:set'), reset: invoke('settings:reset'),
    setSecret: invoke('secret:set'), wipe: invoke('privacy:wipe') },
  ledger: { get: invoke('ledger:get'), clear: invoke('ledger:clear'), onUpdate: on('ledger:update') },
  llm: { models: invoke('llm:models'), test: invoke('llm:test'), chat: invoke('llm:chat'), cancel: invoke('llm:cancel'),
    complete: invoke('llm:complete'), onEvent: on('llm:event') },
  agent: { approve: invoke('agent:approve'), onApproval: on('agent:approval') },
  term: { run: invoke('term:run'), kill: invoke('term:kill'), cwd: invoke('term:cwd'), onData: on('term:data'), onExit: on('term:exit') }
});
