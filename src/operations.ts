import { readFileSync } from 'node:fs';
import { backup, restore, verifyBackup } from './backup.js';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'verify' && args.length === 2) {
    console.log(JSON.stringify(verifyBackup(args[0], readFileSync(args[1], 'utf8'))));
  } else if ((command === 'backup' || command === 'restore') && args.length === 3) {
    console.log(JSON.stringify(await (command === 'backup' ? backup : restore)(args[0], args[1], readFileSync(args[2], 'utf8'))));
  } else throw new Error('Usage: operations backup|restore SOURCE NEW_DESTINATION PUBLIC.pem; operations verify BACKUP PUBLIC.pem');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operation failed');
  process.exitCode = 1;
}
