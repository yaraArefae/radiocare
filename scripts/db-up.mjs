import { spawnSync } from "node:child_process";

const existingDatabase = spawnSync(
  "docker",
  ["inspect", "mysql-server"],
  { stdio: "ignore" },
);
const existingPhpMyAdmin = spawnSync(
  "docker",
  ["inspect", "phpmyadmin"],
  { stdio: "ignore" },
);

const result =
  existingDatabase.status === 0 && existingPhpMyAdmin.status === 0
    ? spawnSync("docker", ["start", "mysql-server", "phpmyadmin"], {
        stdio: "inherit",
      })
    : spawnSync("docker", ["compose", "up", "-d", "--wait"], {
        stdio: "inherit",
      });

if (result.status !== 0) {
  console.error(
    "\nMariaDB could not be started. Open Docker Desktop and try again.\n",
  );
  process.exit(result.status ?? 1);
}
