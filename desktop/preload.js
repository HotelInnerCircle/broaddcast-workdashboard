/**
 * The only thing the page learns from the shell: that it is running inside it. Nothing from Node is
 * exposed - the window loads a live website, so the bridge stays one-way and read-only.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("workpulseDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});
