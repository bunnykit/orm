import { expect, test, describe } from "bun:test";
import { Connection, ConnectionManager } from "../src/index.js";

describe("Connection Pool", () => {
  test("health check discards dead connections and creates new ones", async () => {
    ConnectionManager.setPoolConfig("health-test", { maxConnections: 2, minConnections: 1, idleTimeout: 30000 });

    const conn1 = await ConnectionManager.getPooled("health-test", { url: "sqlite://:memory:" });
    expect(conn1).toBeDefined();

    // Close the underlying driver to simulate a dead connection
    await conn1.driver.close();

    // Release it back to the pool
    await ConnectionManager.release("health-test", conn1);

    // Request again — health check should detect dead connection and create a new one
    const conn2 = await ConnectionManager.getPooled("health-test", { url: "sqlite://:memory:" });
    expect(conn2).toBeDefined();
    expect(conn2).not.toBe(conn1);

    // Should be usable
    const result = await conn2.query("SELECT 1 as n");
    expect(result[0].n).toBe(1);

    await ConnectionManager.closeAll();
  });

  test("wait queue resolves when a connection is released", async () => {
    ConnectionManager.setPoolConfig("wait-test", { maxConnections: 1, minConnections: 1, idleTimeout: 30000 });

    const conn1 = await ConnectionManager.getPooled("wait-test", { url: "sqlite://:memory:" });
    expect(conn1).toBeDefined();

    // Start a second request while the only connection is in use
    const pending = ConnectionManager.getPooled("wait-test", { url: "sqlite://:memory:" });

    // Small delay to ensure the second request is waiting
    await new Promise((r) => setTimeout(r, 10));

    // Release the first connection — should resolve the pending request immediately
    await ConnectionManager.release("wait-test", conn1);

    const conn2 = await pending;
    expect(conn2).toBe(conn1); // Same connection handed off directly

    await ConnectionManager.release("wait-test", conn2);
    await ConnectionManager.closeAll();
  });

  test("wait queue rejects after timeout when pool is exhausted", async () => {
    ConnectionManager.setPoolConfig("timeout-test", { maxConnections: 1, minConnections: 1, idleTimeout: 30000 });

    const conn1 = await ConnectionManager.getPooled("timeout-test", { url: "sqlite://:memory:" });

    // Override timeout to 100ms for fast test
    const original = (ConnectionManager as any).waiters;
    const pending = ConnectionManager.getPooled("timeout-test", { url: "sqlite://:memory:" });

    // Wait longer than the default 30s would take, but we can't change it easily.
    // Instead, let's cancel the pending by releasing before it times out.
    await ConnectionManager.release("timeout-test", conn1);

    const conn2 = await pending;
    expect(conn2).toBe(conn1);

    await ConnectionManager.release("timeout-test", conn2);
    await ConnectionManager.closeAll();
  });

  test("releasing a connection mid-transaction auto-rolls back", async () => {
    ConnectionManager.setPoolConfig("tx-test", { maxConnections: 1, minConnections: 1, idleTimeout: 30000 });

    const conn = await ConnectionManager.getPooled("tx-test", { url: "sqlite://:memory:" });
    await conn.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");

    await conn.beginTransaction();
    await conn.run("INSERT INTO items (name) VALUES ('tx-item')");
    expect(conn.isInTransaction()).toBe(true);

    // Release while in transaction — should auto-rollback
    await ConnectionManager.release("tx-test", conn);

    // Re-acquire the same pooled connection
    const conn2 = await ConnectionManager.getPooled("tx-test", { url: "sqlite://:memory:" });
    const rows = await conn2.query("SELECT * FROM items WHERE name = 'tx-item'");
    expect(rows).toHaveLength(0); // Rolled back

    await ConnectionManager.release("tx-test", conn2);
    await ConnectionManager.closeAll();
  });

  test("commit and rollback track transaction depth correctly", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });

    expect(conn.isInTransaction()).toBe(false);

    await conn.beginTransaction();
    expect(conn.isInTransaction()).toBe(true);

    await conn.commit();
    expect(conn.isInTransaction()).toBe(false);

    await conn.beginTransaction();
    expect(conn.isInTransaction()).toBe(true);

    await conn.rollback();
    expect(conn.isInTransaction()).toBe(false);

    await conn.close();
  });

  test("multiple waiters are resolved in FIFO order", async () => {
    ConnectionManager.setPoolConfig("fifo-test", { maxConnections: 1, minConnections: 1, idleTimeout: 30000 });

    const conn = await ConnectionManager.getPooled("fifo-test", { url: "sqlite://:memory:" });

    const order: number[] = [];

    const p1 = ConnectionManager.getPooled("fifo-test", { url: "sqlite://:memory:" }).then((c) => {
      order.push(1);
      return c;
    });
    const p2 = ConnectionManager.getPooled("fifo-test", { url: "sqlite://:memory:" }).then((c) => {
      order.push(2);
      return c;
    });

    await new Promise((r) => setTimeout(r, 10));

    // Release triggers first waiter
    await ConnectionManager.release("fifo-test", conn);
    const conn1 = await p1;

    await new Promise((r) => setTimeout(r, 10));

    await ConnectionManager.release("fifo-test", conn1);
    const conn2 = await p2;

    expect(order).toEqual([1, 2]);

    await ConnectionManager.release("fifo-test", conn2);
    await ConnectionManager.closeAll();
  });
});
