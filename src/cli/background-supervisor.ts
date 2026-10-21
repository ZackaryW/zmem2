import { supervise } from '../core/background-service.js';

const home = process.argv[2];
if (!home) process.exitCode = 2;
else
  await supervise(home).catch(() => {
    process.exitCode = 1;
  });
