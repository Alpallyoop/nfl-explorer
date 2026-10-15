"use strict";
// Sandboxed preload: exposes exactly three calls to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nflBridge", {
  config: () => ipcRenderer.invoke("nfl:config"),
  request: (op, params) => ipcRenderer.invoke("nfl:request", String(op), params || {}),
  hashFile: () => ipcRenderer.invoke("nfl:hashFile")
});
