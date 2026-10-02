const net = require('net');
const { spawnSync } = require('child_process');
const path = require('path');

/**
 * Check if a port is in use (IPv4 or IPv6)
 */
function isPortInUse(port) {
    const pid = getPortPid(port);
    if (pid && pid !== process.pid) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(true);
                } else {
                    resolve(false);
                }
            })
            .once('listening', () => {
                tester.once('close', () => resolve(false)).close();
            })
            .listen(port);
    });
}

/**
 * Find PID listening on given port in Windows
 */
function getPortPid(port) {
    // Method 1: Get-NetTCPConnection via PowerShell (Language-Independent)
    try {
        const res = spawnSync('powershell', [
            '-NoProfile',
            '-Command',
            `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c.OwningProcess | Select-Object -First 1 }`
        ], { encoding: 'utf8', timeout: 4000 });

        if (res.stdout) {
            const pid = parseInt(res.stdout.trim(), 10);
            if (!isNaN(pid) && pid > 0) return pid;
        }
    } catch (e) {}

    // Method 2: netstat fallback
    try {
        const res = spawnSync('cmd.exe', ['/c', 'netstat -ano -p tcp'], { encoding: 'utf8', timeout: 4000 });
        const output = res.stdout || '';
        const lines = output.split(/\r?\n/);
        for (const line of lines) {
            if (line.includes(':' + port)) {
                const parts = line.trim().split(/\s+/);
                // parts[parts.length - 1] is always the PID in netstat -ano
                const last = parseInt(parts[parts.length - 1], 10);
                if (!isNaN(last) && last > 0) return last;
            }
        }
    } catch (e) {}

    return null;
}

/**
 * Get command line and process name of a process by PID on Windows
 */
function getProcessDetails(pid) {
    if (!pid) return { name: '', cmdLine: '' };

    let cmdLine = '';
    let name = '';

    // Get CommandLine via PowerShell
    try {
        const res = spawnSync('powershell', [
            '-NoProfile',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`
        ], { encoding: 'utf8', timeout: 4000 });
        cmdLine = (res.stdout || '').trim();
    } catch (e) {}

    // Get Name via tasklist
    try {
        const res = spawnSync('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], {
            encoding: 'utf8',
            timeout: 3000
        });
        const out = (res.stdout || '').trim();
        // "node.exe","1234",...
        const match = out.match(/^"([^"]+)"/);
        if (match) name = match[1];
    } catch (e) {}

    return { name, cmdLine };
}

/**
 * Terminate a process by PID
 */
function killPid(pid) {
    if (!pid || pid === process.pid) return false;
    try {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
            stdio: 'ignore',
            timeout: 4000
        });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Smart Port Resolver:
 * - If target port is used by THIS program (Schedule / server.js / node running Schedule), kill it and reuse the port!
 * - If target port is used by ANOTHER program, keep it untouched and try the next port (3001, 3002...)!
 */
async function resolveAvailablePort(startPort = 3000, maxAttempts = 30) {
    let port = startPort;
    const currentScriptDir = path.resolve(__dirname).toLowerCase();

    for (let i = 0; i < maxAttempts; i++) {
        const inUse = await isPortInUse(port);
        if (!inUse) {
            return port;
        }

        console.log(`[Port Check] Port ${port} is currently in use. Checking owner...`);
        const pid = getPortPid(port);

        if (pid && pid !== process.pid) {
            const { name, cmdLine } = getProcessDetails(pid);
            const lowerCmd = (cmdLine || '').toLowerCase();
            const lowerName = (name || '').toLowerCase();

            // Check if this process belongs to our Schedule program
            const isOurProgram = lowerCmd.includes('server.js') || 
                                 lowerCmd.includes(currentScriptDir) || 
                                 (lowerName === 'node.exe' && (lowerCmd.includes('schedule') || lowerCmd === ''));

            if (isOurProgram) {
                console.log(`[Port Clean] Port ${port} is occupied by an existing instance of Nile Schedule (PID ${pid}). Terminating old instance...`);
                killPid(pid);
                await sleep(1000);
                const stillInUse = await isPortInUse(port);
                if (!stillInUse) {
                    console.log(`[Port Clean] Port ${port} reclaimed successfully!`);
                    return port;
                }
            } else {
                console.log(`[Port Skip] Port ${port} is occupied by another application (${name || 'PID ' + pid}). Keeping it running untouched.`);
            }
        } else {
            console.log(`[Port Skip] Port ${port} is unavailable. Trying next port...`);
        }

        port++;
    }

    return port;
}

module.exports = {
    isPortInUse,
    getPortPid,
    getProcessDetails,
    killPid,
    resolveAvailablePort
};
