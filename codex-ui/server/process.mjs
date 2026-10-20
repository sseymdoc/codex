import { spawn } from "node:child_process";

// app-server exits once stdin closes; force-kill only if it lingers.
export function stop(child, force) {
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  };
  child.stdin.end();
  if (force) kill();
  else setTimeout(kill, 3000).unref();
}
