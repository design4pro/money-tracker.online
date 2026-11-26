export async function release({ workers, migrate, deploy, verify, finish, rollback, onRollbackFailure }) {
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
      try {
        await rollback(worker);
      } catch {
        onRollbackFailure(worker);
      }
    }
    throw error;
  }
}
