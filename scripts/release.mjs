export async function release({ workers, snapshots, migrate, deploy, verify, finish, rollback, onNoBaseline, onRollbackFailure }) {
  const attempted = [];
  try {
    await migrate();
    for (const worker of workers) {
      attempted.push(worker);
      await deploy(worker);
    }
    await verify();
    await finish();
  } catch (error) {
    for (const worker of attempted.reverse()) {
      if (snapshots[worker] === null) {
        onNoBaseline(worker);
        continue;
      }
      try {
        await rollback(worker, snapshots[worker]);
      } catch {
        onRollbackFailure(worker);
      }
    }
    throw error;
  }
}
