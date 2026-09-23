import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * Makes the in-memory Mongo URI visible to test files via `inject('mongoUri')`.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let mongo: MongoMemoryServer | undefined;

/**
 * Starts one in-memory MongoDB for the whole test run.
 *
 * Tests get a real MongoDB (real indexes, real aggregation, real unique-key
 * errors) with none of the shared-state problems of pointing the suite at the
 * Docker container: the data is per-run and disappears afterwards, and CI does
 * not need a database service.
 */
export async function setup(project: TestProject): Promise<void> {
  mongo = await MongoMemoryServer.create({
    // The default is 10s, which the very first run blows through while it is
    // still downloading the mongod binary.
    instance: { launchTimeout: 120_000 },
  });

  project.provide('mongoUri', mongo.getUri('intellmeet-test'));
}

export async function teardown(): Promise<void> {
  await mongo?.stop();
}
