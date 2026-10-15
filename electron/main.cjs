"use strict";
// NFL Explorer - Electron main process.
// The renderer is sandboxed (no Node). It can only ask for the allow-listed nfl.api.v1 operations in
// nflClient.cjs and for a local file's SHA-256 (the file is hashed here; its path is not sent to NFL).
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const client = require("./nflClient.cjs");

const API_BASE = (() => {
  try { return client.normalizeBase(process.env.NFL_API_BASE || client.DEFAULT_BASE); }
  catch { return client.DEFAULT_BASE; }
})();
const DEV_URL = process.env.NFL_EXPLORER_DEV_URL || "http://127.0.0.1:5173";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#0c1016",
    title: "NFL Explorer",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  // No navigation away from the app, no new windows; external links open in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());

  if (app.isPackaged || process.argv.includes("--use-dist")) {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL(DEV_URL);
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

ipcMain.handle("nfl:config", () => ({ apiBase: API_BASE, desktop: true }));

ipcMain.handle("nfl:request", async (_event, op, params) => {
  if (typeof op !== "string") return { ok: false, status: "REFUSED", error: "UNKNOWN_OPERATION" };
  return client.call(API_BASE, op, params && typeof params === "object" ? params : {});
});

ipcMain.handle("nfl:hashFile", async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
  if (pick.canceled || pick.filePaths.length === 0) return { canceled: true };
  const file = pick.filePaths[0];
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (c) => { bytes += c.length; hash.update(c); })
      .on("end", resolve)
      .on("error", reject);
  });
  return { canceled: false, name: path.basename(file), bytes, sha256: hash.digest("hex") };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
