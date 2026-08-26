import { runDemo } from '../packages/cli/src/commands/demo.js';

runDemo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
