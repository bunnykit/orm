import { Connection, Model, Schema } from "../src/index.js";

export function setupTestDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return connection;
}

export async function teardownTestDb(connection: Connection) {
  await connection.driver.close();
}
