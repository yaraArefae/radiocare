import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const npmCommand = isWindows
  ? (process.env.ComSpec ?? "cmd.exe")
  : "npm";
const database = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./db-up.mjs", import.meta.url))],
  { stdio: "inherit" },
);

if (database.status !== 0) {
  console.error("\nMariaDB could not be started. Make sure Docker Desktop is running.\n");
  process.exit(database.status ?? 1);
}

function npmArguments(workspace, extraArgs = "") {
  const baseCommand = `npm run dev --workspace ${workspace}`;
  const command = extraArgs ? `${baseCommand} -- ${extraArgs}` : baseCommand;

  return isWindows
    ? ["/d", "/s", "/c", command]
    : ["run", "dev", "--workspace", workspace, ...extraArgs.split(" ").filter(Boolean)];
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const withAi = process.argv.includes("--with-ai");
const requiredPorts = withAi ? [3000, 4000, 8001] : [3000, 4000];
const occupiedPorts = [];

for (const port of requiredPorts) {
  if (await isPortInUse(port)) occupiedPorts.push(port);
}

if (occupiedPorts.length > 0) {
  console.error(
    `\nCannot start RadioCare: port(s) ${occupiedPorts.join(", ")} are already in use.`,
  );
  console.error(
    "The project may already be running in another terminal. Stop it with Ctrl+C, then try again.\n",
  );
  process.exit(1);
}

const services = [
  spawn(npmCommand, npmArguments("backend", "--port 4001"), {
    stdio: "inherit",
  }),
  spawn(npmCommand, npmArguments("frontend"), {
    stdio: "inherit",
  }),
];

if (withAi) {
  const aiServiceDirectory = fileURLToPath(
    new URL("../ai-service/", import.meta.url),
  );
  const pythonExecutable = fileURLToPath(
    new URL(
      process.platform === "win32"
        ? "../ai-service/.venv/Scripts/python.exe"
        : "../ai-service/.venv/bin/python",
      import.meta.url,
    ),
  );

  services.push(
    spawn(
      pythonExecutable,
      [
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--reload-dir",
        "app",
        "--port",
        "8001",
      ],
      {
        cwd: aiServiceDirectory,
        stdio: "inherit",
      },
    ),
  );
}

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const service of services) {
    if (service.killed || !service.pid) continue;

    if (isWindows) {
      spawnSync(
        "taskkill",
        ["/pid", String(service.pid), "/T", "/F"],
        { stdio: "ignore" },
      );
    } else {
      service.kill("SIGTERM");
    }
  }

  process.exitCode = exitCode;
}

for (const service of services) {
  service.on("exit", (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
