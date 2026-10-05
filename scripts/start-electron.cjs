const { spawn } = require("node:child_process");
const electronPath = require("electron");

// Some terminal hosts set this flag to run Electron's binary as Node. Remove it
// for the child process so the BrowserWindow can be created normally.
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const electron = spawn(electronPath, ["dist/electron/main.js"], {
  env: environment,
  stdio: "inherit",
});

electron.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
