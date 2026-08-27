import { buildApp } from "./app.js";
import { loadGatewayConfig } from "@harbor/config";

const config = loadGatewayConfig();
const { app } = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `Harbor Desk gateway listening on http://${config.host}:${config.port}`,
  );
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
