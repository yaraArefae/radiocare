import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
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
const withMobile = process.argv.includes("--with-mobile");

/*
  On the local network the services have to answer the phone as well as
  the laptop, which means binding to every interface instead of only to
  localhost. The website does not care either way, so this only changes
  what the AI service and Expo listen on.
*/
const overLan = process.argv.includes("--lan");

/* The address the phone would use, printed at the end so it is not guessed. */
function localNetworkAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (
        address.family === "IPv4" &&
        !address.internal &&
        !address.address.startsWith("169.254.") &&
        !address.address.startsWith("172.")
      ) {
        return address.address;
      }
    }
  }

  return "localhost";
}

const requiredPorts = [3000, 4000];

if (withAi) requiredPorts.push(8001);
if (withMobile) requiredPorts.push(8090);

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

/*
  The backend answers on 4000 and nowhere else: that address is compiled
  into the website and into the mobile application, so starting it on
  another port produces a system whose parts cannot find each other.
*/
const services = [
  spawn(npmCommand, npmArguments("backend"), {
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
        "--host",
        overLan ? "0.0.0.0" : "127.0.0.1",
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

if (withMobile) {
  const mobileDirectory = fileURLToPath(new URL("../mobile/", import.meta.url));

  const expoCommand = `npx expo start --port 8090${overLan ? " --lan" : ""}`;

  services.push(
    spawn(
      npmCommand,
      isWindows
        ? ["/d", "/s", "/c", expoCommand]
        : ["-c", expoCommand],
      {
        cwd: mobileDirectory,
        stdio: "inherit",
        shell: !isWindows,
      },
    ),
  );
}

const address = overLan ? localNetworkAddress() : "localhost";

console.log("\n──────────────────────────────────────────────");
console.log("  RadioCare is starting");
console.log("──────────────────────────────────────────────");
console.log(`  Website        http://${address}:3000`);
console.log(`  Backend API    http://${address}:4000`);

if (withAi) console.log(`  AI service     http://${address}:8001`);

if (withMobile) {
  console.log(`  Mobile (web)   http://localhost:8090`);

  if (overLan) {
    console.log(`  Mobile (phone) exp://${address}:8090`);
  }
}

console.log("──────────────────────────────────────────────\n");

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
