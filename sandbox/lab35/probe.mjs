import { readFileSync, writeFileSync } from 'node:fs';
// Fixed disposable course fixtures only. Never accepts a host or user-selected path.
const marker = readFileSync('/workspace/run-marker.txt', 'utf8').trim();
if (!/^[a-f0-9]{16}$/.test(marker)) throw new Error('Invalid run marker.');
const tests = [];
function probe(id, operation, path, attempt) {
  try { attempt(); tests.push({ id, operation, path, actual: 'allowed', code: null }); }
  catch (error) { tests.push({ id, operation, path, actual: ['EACCES', 'EPERM', 'EROFS'].includes(error.code) ? 'denied' : 'error', code: error.code || 'UNKNOWN' }); }
}
probe('workspace-read', 'read', '/workspace/data/allowed.txt', () => { if (readFileSync('/workspace/data/allowed.txt', 'utf8').trim() !== `workspace_${marker}`) throw new Error('Wrong workspace fixture.'); });
probe('workspace-write', 'write', '/workspace/result.txt', () => { writeFileSync('/workspace/result.txt', `result_${marker}`); if (readFileSync('/workspace/result.txt', 'utf8') !== `result_${marker}`) throw new Error('Write verification failed.'); });
probe('protected-read', 'read', '/protected/course-private.txt', () => readFileSync('/protected/course-private.txt'));
probe('traversal-read', 'read', '/workspace/../protected/course-private.txt', () => readFileSync('/workspace/../protected/course-private.txt'));
probe('symlink-read', 'read', '/workspace/private-link', () => readFileSync('/workspace/private-link'));
probe('protected-write', 'write', '/protected/course-private.txt', () => writeFileSync('/protected/course-private.txt', 'Synthetic boundary probe'));
probe('readonly-write', 'write', '/opt/lab35/immutable.txt', () => writeFileSync('/opt/lab35/immutable.txt', 'Synthetic boundary probe'));
// A deliberate counterexample to the claim that everything outside /workspace is hidden.
probe('runtime-read', 'read', '/etc/os-release', () => readFileSync('/etc/os-release'));
console.log(JSON.stringify({ marker, uid: process.getuid(), tests }));
