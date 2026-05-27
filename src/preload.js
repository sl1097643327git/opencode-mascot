const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mascotApi', {
  async getInitialState() {
    return ipcRenderer.invoke('mascot:get-state');
  },
  async getFrames(characterId, status) {
    return ipcRenderer.invoke('mascot:get-frames', characterId, status);
  },
  async updateCharacterPosition(characterId, position) {
    return ipcRenderer.invoke('mascot:update-character-position', characterId, position);
  },
  async getThemes() {
    return ipcRenderer.invoke('mascot:get-themes');
  },
  async updateCharacter(characterId, patch) {
    return ipcRenderer.invoke('mascot:update-character', characterId, patch);
  },
  async deleteCharacter(characterId) {
    return ipcRenderer.invoke('mascot:delete-character', characterId);
  },
  async setMouseInteraction(interactive) {
    return ipcRenderer.invoke('mascot:set-mouse-interaction', { interactive: Boolean(interactive) });
  },
  onStateChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('mascotApi.onStateChange requires a callback function');
    }

    const handler = (_event, state) => {
      callback(state);
    };

    ipcRenderer.on('mascot:state', handler);

    return function unsubscribe() {
      ipcRenderer.removeListener('mascot:state', handler);
    };
  }
});
