// server.js - Painel de informações do sistema (Express)
// Uso: npm install express && node server.js  ->  http://localhost:3000
const express = require('express');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

const GB = (b) => +(b / 1024 ** 3).toFixed(2);
const MB = (b) => +(b / 1024 ** 2).toFixed(1);
const run = (cmd) => new Promise((r) => exec(cmd, { timeout: 8000, maxBuffer: 8e6 }, (e, o) => r(e ? null : String(o).trim())));
const ps = (c) => run(`powershell -NoProfile -Command "${c}"`);
const json = (s) => { try { const d = JSON.parse(s); return Array.isArray(d) ? d : [d]; } catch { return []; } };
const lerArq = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
const tempo = (s) => `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}min`;

// ---- Uso real da CPU (amostrado a cada segundo) ----
let prev = os.cpus();
const uso = { total: 0, nucleos: [] };
setInterval(() => {
  const cur = os.cpus();
  const soma = (t) => Object.values(t).reduce((a, b) => a + b, 0);
  uso.nucleos = cur.map((c, i) => {
    const dt = soma(c.times) - soma(prev[i].times);
    return dt ? +(100 * (1 - (c.times.idle - prev[i].times.idle) / dt)).toFixed(1) : 0;
  });
  uso.total = +(uso.nucleos.reduce((a, b) => a + b, 0) / uso.nucleos.length).toFixed(1);
  prev = cur;
}, 1000);

// ---- Coletores ----
async function nomeSO() {
  if (WIN) return (await ps('(Get-CimInstance Win32_OperatingSystem).Caption')) || os.type();
  if (MAC) return 'macOS ' + ((await run('sw_vers -productVersion')) || '');
  const m = (lerArq('/etc/os-release') || '').match(/PRETTY_NAME="?([^"\n]+)/);
  return m ? m[1] : os.type();
}

async function getSistema() {
  return {
    sistemaOperacional: await nomeSO(),
    nomeDoComputador: os.hostname(),
    versaoKernel: os.release(),
    arquitetura: os.arch(),
    usuario: os.userInfo().username,
    ligadoHa: tempo(os.uptime()),
    fusoHorario: Intl.DateTimeFormat().resolvedOptions().timeZone,
    idioma: Intl.DateTimeFormat().resolvedOptions().locale,
    nodeVersao: process.version,
  };
}

function getCpu() {
  const c = os.cpus();
  const l = os.loadavg();
  return {
    modelo: c[0]?.model.trim(), nucleos: c.length, mhz: c[0]?.speed,
    usoTotal: uso.total, usoPorNucleo: uso.nucleos,
    carga: WIN ? null : { m1: +l[0].toFixed(2), m5: +l[1].toFixed(2), m15: +l[2].toFixed(2) },
  };
}

function getMemoria() {
  const t = os.totalmem(), f = os.freemem(), p = process.memoryUsage();
  return { totalGB: GB(t), livreGB: GB(f), usadaGB: GB(t - f), pct: +(((t - f) / t) * 100).toFixed(1), nodeMB: MB(p.rss) };
}

async function getDiscos() {
  if (WIN) {
    return json(await ps('Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress'))
      .filter((d) => d.Size).map((d) => ({ nome: d.DeviceID + ' ' + (d.VolumeName || ''), formato: d.FileSystem, totalGB: GB(d.Size), livreGB: GB(d.FreeSpace), pct: +(100 - (d.FreeSpace / d.Size) * 100).toFixed(1) }));
  }
  const o = await run('df -kP');
  return (o || '').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 6 && /^\/dev\//.test(c[0]) && !c[5].startsWith('/snap'))
    .map((c) => ({ nome: c.slice(5).join(' '), formato: c[0], totalGB: GB(c[1] * 1024), livreGB: GB(c[3] * 1024), pct: parseFloat(c[4]) }));
}

async function getGpu() {
  if (WIN) return json(await ps('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress')).map((g) => ({ nome: g.Name, memoriaGB: g.AdapterRAM ? GB(g.AdapterRAM) : null, driver: g.DriverVersion }));
  const o = MAC ? await run("system_profiler SPDisplaysDataType | grep -E 'Chipset Model|VRAM'") : await run("lspci | grep -iE 'vga|3d|display'");
  return (o || '').split('\n').filter(Boolean).map((l) => ({ nome: l.replace(/^\S+\s+\S+\s+/, '').trim() }));
}

async function getPlaca() {
  if (WIN) {
    const [b, c, bi] = await Promise.all([
      ps('Get-CimInstance Win32_BaseBoard | Select Manufacturer,Product | ConvertTo-Json -Compress'),
      ps('Get-CimInstance Win32_ComputerSystem | Select Manufacturer,Model | ConvertTo-Json -Compress'),
      ps('Get-CimInstance Win32_BIOS | Select SMBIOSBIOSVersion | ConvertTo-Json -Compress')]);
    return { fabricante: json(c)[0]?.Manufacturer, modelo: json(c)[0]?.Model, placaMae: json(b)[0]?.Product, bios: json(bi)[0]?.SMBIOSBIOSVersion };
  }
  if (MAC) return { modelo: await run("sysctl -n hw.model") };
  const d = (f) => lerArq('/sys/class/dmi/id/' + f);
  return { fabricante: d('sys_vendor'), modelo: d('product_name'), placaMae: d('board_name'), bios: d('bios_version') };
}

function getRede() {
  const r = [];
  for (const [nome, ends] of Object.entries(os.networkInterfaces()))
    for (const a of ends || []) r.push({ nome, tipo: a.family, ip: a.address, mac: a.mac, local: a.internal });
  return r;
}

async function getPortas() {
  const o = WIN ? await run('netstat -an | findstr LISTENING') : MAC ? await run('netstat -an | grep LISTEN') : await run('ss -tuln');
  return (o || '').split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 4).slice(0, 60)
    .map((c) => (WIN || MAC ? c.slice(0, 4).join('  ') : `${c[0]}  ${c[4]}`));
}

async function getBateria() {
  if (WIN) { const b = json(await ps('Get-CimInstance Win32_Battery | Select EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress'))[0]; return b ? { pct: b.EstimatedChargeRemaining, carregando: b.BatteryStatus === 2 } : null; }
  if (MAC) { const o = await run('pmset -g batt'); const m = o && o.match(/(\d+)%;\s*(\w+)/); return m ? { pct: +m[1], carregando: m[2] === 'charging' } : null; }
  const cap = lerArq('/sys/class/power_supply/BAT0/capacity');
  return cap ? { pct: +cap, carregando: lerArq('/sys/class/power_supply/BAT0/status') === 'Charging' } : null;
}

function getTemperaturas() {
  if (WIN || MAC) return [];
  try {
    return fs.readdirSync('/sys/class/thermal').filter((z) => z.startsWith('thermal_zone')).map((z) => ({
      sensor: lerArq(`/sys/class/thermal/${z}/type`) || z, c: +(lerArq(`/sys/class/thermal/${z}/temp`) / 1000).toFixed(1) })).filter((t) => t.c > 0);
  } catch { return []; }
}

async function getProcessos() {
  let lista = [];
  if (WIN) {
    lista = json(await ps("Get-Process | Select Id,ProcessName,CPU,WorkingSet64,@{n='T';e={$_.Threads.Count}} | ConvertTo-Json -Compress"))
      .map((p) => ({ pid: p.Id, nome: p.ProcessName, usuario: '-', cpu: +(p.CPU || 0).toFixed(1), memMB: MB(p.WorkingSet64), threads: p.T, estado: 'ativo', tempo: '-' }));
  } else {
    const o = await run('ps -eo pid=,user=,pcpu=,rss=,stat=,etime=,comm=');
    lista = (o || '').split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 7)
      .map((c) => ({ pid: +c[0], usuario: c[1], cpu: +c[2], memMB: +(c[3] / 1024).toFixed(1), estado: c[4], tempo: c[5], nome: c.slice(6).join(' ').split('/').pop(), threads: null }));
  }
  const por = (k) => lista.reduce((n, p) => n + (p.estado[0] === k ? 1 : 0), 0);
  return { total: lista.length, zumbis: por('Z'), rodando: por('R'), lista: lista.sort((a, b) => b.memMB - a.memMB).slice(0, 400) };
}

// ---- Detalhes avançados da máquina (CPU, RAM, GPU, energia, sensores) ----
const memo = (f) => { let p; return () => (p ||= f()); };
const ttl = (f, ms) => { let t = 0, v; return async () => { if (Date.now() - t > ms) { v = await f(); t = Date.now(); } return v; }; };
const listar = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const num = (f) => { const v = lerArq(f); return v === null || v === '' || isNaN(v) ? null : Number(v); };
const na = (v) => (v === undefined || /N\/A|Not Supported|\[/i.test(String(v)) || isNaN(v) ? null : Number(v));
const r1 = (v) => (v == null ? null : +v.toFixed(1));

// Amostragem de potência da CPU (Intel/AMD RAPL, Linux) e tráfego de rede
let raplPrev = null, cpuWatts = null, netPrev = null, netVel = { rx: 0, tx: 0 };
const raplLer = () => {
  let t = 0, ok = false;
  for (const d of listar('/sys/class/powercap').filter((n) => /^(intel|amd)-rapl:\d+$/.test(n))) {
    const e = num(`/sys/class/powercap/${d}/energy_uj`);
    if (e !== null) { t += e; ok = true; }
  }
  return ok ? t : null;
};
setInterval(() => {
  if (WIN || MAC) return;
  const agora = Date.now(), e = raplLer();
  if (e !== null) {
    if (raplPrev && e >= raplPrev.e) cpuWatts = r1((e - raplPrev.e) / 1e6 / ((agora - raplPrev.t) / 1000));
    raplPrev = { e, t: agora };
  }
  const nd = lerArq('/proc/net/dev');
  if (nd) {
    let rx = 0, tx = 0;
    nd.split('\n').slice(2).forEach((l) => { const [n, r] = l.split(':'); if (!r || n.trim() === 'lo') return; const c = r.trim().split(/\s+/).map(Number); rx += c[0]; tx += c[8]; });
    if (netPrev) { const s = (agora - netPrev.t) / 1000; netVel = { rx: Math.max(0, (rx - netPrev.rx) / s), tx: Math.max(0, (tx - netPrev.tx) / s) }; }
    netPrev = { rx, tx, t: agora };
  }
}, 2000);

const cpuDetalhe = memo(async () => {
  const c = os.cpus(), base = { modelo: c[0]?.model.trim(), threads: c.length };
  if (WIN) {
    const p = json(await ps('Get-CimInstance Win32_Processor | Select Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,L2CacheSize,L3CacheSize,VirtualizationFirmwareEnabled | ConvertTo-Json -Compress'));
    if (!p.length) return base;
    const nf = p.reduce((a, x) => a + x.NumberOfCores, 0), th = p.reduce((a, x) => a + x.NumberOfLogicalProcessors, 0);
    return { ...base, fabricante: p[0].Manufacturer, soquetes: p.length, nucleosFisicos: nf, threads: th, threadsPorNucleo: +(th / nf).toFixed(1), maxMHz: p[0].MaxClockSpeed, cache: { l2: p[0].L2CacheSize + ' KB', l3: p[0].L3CacheSize + ' KB' }, virtualizacao: p[0].VirtualizationFirmwareEnabled ? 'Ativada' : 'Desativada' };
  }
  if (MAC) {
    const o = ((await run('sysctl -n hw.physicalcpu hw.packages hw.l2cachesize hw.l3cachesize')) || '').split('\n');
    const kb = (v) => (v && !isNaN(v) ? Math.round(v / 1024) + ' KB' : null);
    return { ...base, nucleosFisicos: +o[0] || null, soquetes: +o[1] || null, threadsPorNucleo: o[0] ? +(c.length / o[0]).toFixed(1) : null, cache: { l2: kb(o[2]), l3: kb(o[3]) } };
  }
  const m = {};
  ((await run('lscpu')) || '').split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
  const soq = +m['Socket(s)'] || 1;
  return { ...base, fabricante: m['Vendor ID'], soquetes: soq, nucleosFisicos: +m['Core(s) per socket'] * soq || null, threadsPorNucleo: +m['Thread(s) per core'] || null,
    maxMHz: parseFloat(m['CPU max MHz']) || null, minMHz: parseFloat(m['CPU min MHz']) || null,
    cache: { l1d: m['L1d cache'], l1i: m['L1i cache'], l2: m['L2 cache'], l3: m['L3 cache'] },
    virtualizacao: m['Virtualization'] || (m['Hypervisor vendor'] ? 'Máquina virtual (' + m['Hypervisor vendor'] + ')' : null) };
});

function mhzAtual() {
  if (WIN || MAC) return os.cpus()[0]?.speed || null;
  const v = ((lerArq('/proc/cpuinfo') || '').match(/cpu MHz\s*:\s*[\d.]+/g) || []).map((x) => parseFloat(x.split(':')[1]));
  return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : os.cpus()[0]?.speed || null;
}

const pentes = memo(async () => {
  if (WIN) {
    const tipos = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 34: 'DDR5' };
    return json(await ps('Get-CimInstance Win32_PhysicalMemory | Select DeviceLocator,Capacity,Speed,ConfiguredClockSpeed,Manufacturer,PartNumber,SMBIOSMemoryType | ConvertTo-Json -Compress'))
      .map((p) => ({ slot: p.DeviceLocator, tamanhoGB: GB(p.Capacity), tipo: tipos[p.SMBIOSMemoryType] || '-', velocidade: (p.ConfiguredClockSpeed || p.Speed) + ' MT/s', fabricante: (p.Manufacturer || '').trim() }));
  }
  if (MAC) return [];
  const o = await run('dmidecode -t memory 2>/dev/null'); // exige root
  return (o || '').split('\n\n').filter((b) => /Memory Device/.test(b) && /Size: \d/.test(b)).map((b) => {
    const g = (k) => (b.match(new RegExp('\\n\\s*' + k + ': (.+)')) || [])[1];
    const s = g('Size') || '', n = parseFloat(s);
    return { slot: g('Locator'), tamanhoGB: /MB/.test(s) ? +(n / 1024).toFixed(1) : n, tipo: g('Type'), velocidade: g('Configured Memory Speed') || g('Speed'), fabricante: g('Manufacturer') };
  });
});

const memDetalhe = ttl(async () => {
  const r = { pentes: await pentes() };
  if (WIN) {
    const s = json(await ps('Get-CimInstance Win32_PageFileUsage | Select AllocatedBaseSize,CurrentUsage | ConvertTo-Json -Compress'))[0];
    if (s) Object.assign(r, { swapTotalGB: +(s.AllocatedBaseSize / 1024).toFixed(2), swapUsadoGB: +(s.CurrentUsage / 1024).toFixed(2) });
  } else if (!MAC) {
    const m = {};
    (lerArq('/proc/meminfo') || '').split('\n').forEach((l) => { const x = l.match(/^(\w+):\s+(\d+)/); if (x) m[x[1]] = +x[2] * 1024; });
    Object.assign(r, { disponivelGB: GB(m.MemAvailable), cacheGB: GB(m.Cached), buffersGB: GB(m.Buffers), compartilhadaGB: GB(m.Shmem), swapTotalGB: GB(m.SwapTotal), swapUsadoGB: GB(m.SwapTotal - m.SwapFree) });
  }
  return r;
}, 5000);

async function gpuDetalhe() {
  const lista = [];
  const o = await run('nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw,power.limit,clocks.gr,clocks.mem,fan.speed,pstate --format=csv,noheader,nounits');
  (o || '').split('\n').filter(Boolean).forEach((l) => {
    const c = l.split(',').map((x) => x.trim());
    if (c.length < 12) return;
    lista.push({ fabricante: 'NVIDIA', nome: c[0], driver: c[1], vramTotalMB: na(c[2]), vramUsadaMB: na(c[3]), uso: na(c[4]), tempC: na(c[5]), watts: na(c[6]), wattsLimite: na(c[7]), clockMHz: na(c[8]), clockMemMHz: na(c[9]), ventoinhaPct: na(c[10]), estado: c[11] });
  });
  if (!WIN && !MAC) {
    for (const card of listar('/sys/class/drm').filter((n) => /^card\d+$/.test(n))) {
      const d = `/sys/class/drm/${card}/device`, v = lerArq(d + '/vendor');
      if (!v || v === '0x10de') continue;
      const hw = listar(d + '/hwmon')[0], h = hw ? `${d}/hwmon/${hw}` : null;
      const tot = num(d + '/mem_info_vram_total'), us = num(d + '/mem_info_vram_used'), t = h && num(h + '/temp1_input'), p = h && (num(h + '/power1_average') ?? num(h + '/power1_input'));
      lista.push({ fabricante: v === '0x1002' ? 'AMD' : v === '0x8086' ? 'Intel' : v, nome: lerArq(d + '/product_name') || card, vramTotalMB: tot ? Math.round(tot / 1048576) : null, vramUsadaMB: us ? Math.round(us / 1048576) : null,
        uso: num(d + '/gpu_busy_percent'), tempC: t ? r1(t / 1000) : null, watts: p ? r1(p / 1e6) : null, clockMHz: null, ventoinhaPct: null });
    }
  }
  return lista;
}

const acpiTemp = ttl(async () => {
  if (!WIN) return null;
  const o = await ps('(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue).CurrentTemperature');
  const v = parseFloat((o || '').split('\n')[0]);
  return v ? r1(v / 10 - 273.15) : null;
}, 10000);

async function sensores() {
  const s = { temperaturas: [], ventoinhas: [], potencias: [], cpuTemp: null };
  if (WIN) { s.cpuTemp = await acpiTemp(); return s; }
  if (MAC) return s;
  const base = '/sys/class/hwmon';
  for (const h of listar(base)) {
    const chip = lerArq(`${base}/${h}/name`) || h;
    for (const f of listar(`${base}/${h}`)) {
      let m;
      if ((m = f.match(/^temp(\d+)_input$/))) { const v = num(`${base}/${h}/${f}`); if (v !== null) s.temperaturas.push({ chip, sensor: lerArq(`${base}/${h}/temp${m[1]}_label`) || 'temp' + m[1], c: r1(v / 1000) }); }
      else if ((m = f.match(/^fan(\d+)_input$/))) { const v = num(`${base}/${h}/${f}`); if (v !== null) s.ventoinhas.push({ chip, sensor: 'fan' + m[1], rpm: v }); }
      else if ((m = f.match(/^power(\d+)_(average|input)$/))) { const v = num(`${base}/${h}/${f}`); if (v !== null) s.potencias.push({ chip, sensor: 'power' + m[1], w: r1(v / 1e6) }); }
    }
  }
  const cpu = s.temperaturas.filter((t) => /coretemp|k10temp|zenpower|cpu[-_]thermal/.test(t.chip));
  const pk = cpu.find((t) => /package|tctl|tdie/i.test(t.sensor));
  s.cpuTemp = pk ? pk.c : cpu.length ? Math.max(...cpu.map((t) => t.c)) : null;
  return s;
}

function bateriaWatts() {
  if (WIN || MAC) return null;
  const p = num('/sys/class/power_supply/BAT0/power_now');
  if (p) return r1(p / 1e6);
  const i = num('/sys/class/power_supply/BAT0/current_now'), v = num('/sys/class/power_supply/BAT0/voltage_now');
  return i && v ? r1((i * v) / 1e12) : null;
}

async function getMaquina() {
  const [cpu, memoria, gpus, sens] = await Promise.all([cpuDetalhe(), memDetalhe(), gpuDetalhe(), sensores()]);
  const gW = gpus.reduce((a, g) => a + (g.watts || 0), 0);
  return { cpu: { ...cpu, atualMHz: mhzAtual(), tempC: sens.cpuTemp, watts: cpuWatts }, memoria, gpus, sensores: sens,
    energia: { cpuW: cpuWatts, gpuW: gW ? r1(gW) : null, bateriaW: bateriaWatts() }, rede: WIN || MAC ? null : netVel };
}

app.get('/api/all', async (req, res) => {
  try {
    const [sistema, discos, gpu, placa, portas, bateria, processos, maquina] = await Promise.all([getSistema(), getDiscos(), getGpu(), getPlaca(), getPortas(), getBateria(), getProcessos(), getMaquina()]);
    res.json({ hora: new Date().toLocaleTimeString('pt-BR'), sistema, maquina, placa, cpu: getCpu(), memoria: getMemoria(), discos, gpu, rede: getRede(), portas, bateria, temperaturas: getTemperaturas(), processos });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/', (req, res) => res.type('html').send(PAGINA));

app.listen(PORT, () => console.log(`Painel rodando em http://localhost:${PORT}`));

// ---- Página ----
const PAGINA = String.raw`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Raio-X do Computador</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#000;color:#d4d4d4}
nav{position:fixed;top:0;left:0;right:0;z-index:10;display:flex;justify-content:space-between;align-items:center;padding:14px 28px;background:#000a;backdrop-filter:blur(12px);border-bottom:1px solid #ffffff0f}
nav b{color:#fff}nav div a{color:#a3a3a3;text-decoration:none;font-size:.85rem;margin-left:20px}nav div a:hover{color:#fff}
.hero{position:relative;min-height:92vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:110px 20px 40px;overflow:hidden;background:radial-gradient(ellipse at 50% 85%,#333 0,#0a0a0a 45%,#000 75%)}
.hero svg{position:absolute;inset:0;width:100%;height:100%;opacity:.55}
.hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:45%;background:repeating-linear-gradient(90deg,#ffffff14 0 1px,transparent 1px 28px);-webkit-mask:linear-gradient(transparent,#000);mask:linear-gradient(transparent,#000)}
.hero>*{position:relative;z-index:2}h1{font-size:clamp(2.2rem,6vw,4.2rem);line-height:1.08;margin:0 0 14px;font-weight:700;background:linear-gradient(180deg,#fff,#8a8a8a);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:#a3a3a3;max-width:520px;margin:0 0 24px}.btn{background:#fff;color:#000;border:0;border-radius:99px;padding:11px 22px;font-weight:600;font-size:.9rem;text-decoration:none}
.tile{margin-top:44px;width:104px;height:104px;border-radius:28px;background:#111;border:1px solid #3a3a3a;display:grid;place-items:center;box-shadow:0 0 80px #ffffff30,inset 0 0 20px #ffffff10}
.ring{width:76px;height:76px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#22c55e 0deg,#262626 0)}.ring span{width:62px;height:62px;border-radius:50%;background:#0b0b0b;display:grid;place-items:center;color:#fff;font-weight:700;font-size:.95rem}
.tile small{position:absolute;margin-top:132px;color:#737373;font-size:.7rem}
.chips{display:flex;flex-wrap:wrap;gap:14px 34px;justify-content:center;margin-top:70px;color:#e5e5e5;font-weight:600;font-size:.88rem;opacity:.9}.chips i{display:block;font-style:normal;color:#737373;font-size:.65rem;font-weight:500;text-transform:uppercase;letter-spacing:.08em}
section.s{max-width:1100px;margin:auto;padding:90px 20px 0;text-align:center}.pill{display:inline-block;padding:5px 12px;border:1px solid #262626;border-radius:99px;background:#0d0d0d;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:#a3a3a3}
h2.t{font-size:clamp(1.7rem,4vw,2.4rem);color:#fff;margin:16px 0 8px}.sub{color:#737373;max-width:560px;margin:0 auto 34px;font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;text-align:left}.g4{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.card{background:linear-gradient(180deg,#141414,#0a0a0a);border:1px solid #1f1f1f;border-radius:16px;padding:20px;overflow:hidden}.card:hover{border-color:#333}
.card h3{margin:0 0 4px;color:#fff;font-size:1rem}.exp{margin:0 0 14px;color:#737373;font-size:.8rem;line-height:1.5}
.ic{width:42px;height:42px;border-radius:12px;background:#0d0d0d;border:1px solid #2a2a2a;display:grid;place-items:center;font-size:1.2rem;margin-bottom:12px}.step b{color:#525252;font-size:.7rem}
table{width:100%;border-collapse:collapse;font-size:.82rem}td,th{padding:7px 4px;border-bottom:1px solid #1c1c1c;text-align:left;vertical-align:top;color:#d4d4d4}th{color:#737373;font-weight:500;font-size:.7rem;text-transform:uppercase}td small{display:block;color:#525252;font-size:.7rem}td:last-child{color:#fff;word-break:break-word}
.bar{height:8px;background:#1f1f1f;border-radius:6px;overflow:hidden;margin:6px 0 12px}.bar i{display:block;height:100%;transition:width .5s;border-radius:6px}.big{font-size:2.2rem;font-weight:700;color:#fff}
.alert{padding:11px 16px;border-radius:12px;margin:0 auto 8px;font-size:.88rem;max-width:760px;text-align:left;border:1px solid}.ok{background:#052e1633;color:#86efac;border-color:#14532d}.aviso{background:#42200633;color:#fcd34d;border-color:#78350f}.erro{background:#450a0a33;color:#fca5a5;border-color:#7f1d1d}
.tag{display:inline-block;padding:2px 8px;border-radius:99px;background:#1a1a1a;border:1px solid #2a2a2a;color:#a3a3a3;font-size:.7rem;margin:0 4px 4px 0}
input{padding:9px 14px;background:#0d0d0d;border:1px solid #262626;border-radius:10px;color:#fff;font-size:.88rem;min-width:240px}button.f{padding:9px 14px;background:#0d0d0d;border:1px solid #262626;border-radius:10px;color:#a3a3a3;cursor:pointer;font-size:.85rem}button.f.on{background:#fff;color:#000}
.scroll{max-height:420px;overflow:auto}.nuc{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px}.nuc div{font-size:.68rem;color:#737373}pre{margin:0;font-size:.74rem;color:#a3a3a3}
.feat{display:flex;gap:16px;align-items:flex-start;padding:18px;border-radius:14px;background:linear-gradient(180deg,#141414,#0a0a0a);border:1px solid #1f1f1f;transition:.2s}.feat:hover{border-color:#3a3a3a;transform:translateY(-2px)}
.tl{width:52px;height:52px;flex:none;border-radius:14px;background:#0d0d0d;border:1px solid #2a2a2a;display:grid;place-items:center;font-size:1.35rem;box-shadow:inset 0 0 14px #ffffff0a}.ft{flex:1;min-width:0}
.ft h4{margin:2px 0 4px;color:#fff;font-size:.95rem;display:flex;justify-content:space-between;align-items:center;gap:8px}.ft p{margin:0 0 6px;color:#737373;font-size:.78rem;line-height:1.45}
.st{font-size:.6rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;gap:5px;color:#a3a3a3}.st i{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}.st.ok{color:#4ade80}.st.aviso{color:#fbbf24}.st.erro{color:#f87171}#diag .alert{grid-column:1/-1}
footer{text-align:center;color:#525252;font-size:.75rem;padding:70px 20px 40px}
</style></head><body>
<nav><b>◎ Raio-X</b><div><a href="#resumo">Resumo</a><a href="#como">Como funciona</a><a href="#hardware">Hardware</a><a href="#maquina">Detalhes</a><a href="#processos">Processos</a></div></nav>
<header class="hero">
<svg viewBox="0 0 1440 700" preserveAspectRatio="none" fill="none" stroke="#fff" stroke-width="1"><g opacity=".6"><path d="M0 120C200 140 300 400 420 700"/><path d="M0 160C180 190 260 420 340 700"/><path d="M0 200C160 240 220 440 270 700"/><path d="M1440 120C1240 140 1140 400 1020 700"/><path d="M1440 160C1260 190 1180 420 1100 700"/><path d="M1440 200C1280 240 1220 440 1170 700"/></g></svg>
<span class="pill">Monitoramento em tempo real</span><h1 style="margin-top:18px">Raio-X do seu<br>Computador</h1>
<p>Processador, memória, discos e processos explicados de um jeito simples. Atualizado a cada 3 segundos.</p>
<a class="btn" href="#resumo">Ver meu sistema</a>
<div class="tile"><div class="ring" id="ring"><span id="ringn">--</span></div><small>uso da CPU agora</small></div>
<div class="chips" id="chips" style="margin-top:90px"></div></header>

<section class="s" id="resumo"><span class="pill">Diagnóstico</span><h2 class="t">Como está a sua máquina?</h2><p class="sub">Um resumo rápido, sem termos técnicos. Atualizado às <b id="hora">--</b>.</p><div class="grid" id="diag"></div></section>

<section class="s" id="como"><span class="pill">Coletar • Analisar • Explicar • Atualizar</span><h2 class="t">Como funciona</h2><p class="sub">O servidor Express lê os dados reais do seu sistema e entrega tudo de forma visual.</p>
<div class="grid g4">
<div class="card step"><div class="ic">🔍</div><b>01</b><h3>Coleta</h3><p class="exp">Lê CPU, RAM, discos, rede e processos direto do sistema operacional.</p></div>
<div class="card step"><div class="ic">📊</div><b>02</b><h3>Análise</h3><p class="exp">Calcula uso real, porcentagens e detecta problemas como disco cheio.</p></div>
<div class="card step"><div class="ic">💬</div><b>03</b><h3>Tradução</h3><p class="exp">Explica cada item em linguagem simples, para qualquer pessoa entender.</p></div>
<div class="card step"><div class="ic">⚡</div><b>04</b><h3>Tempo real</h3><p class="exp">A página se atualiza sozinha, sem precisar recarregar.</p></div></div></section>

<section class="s" id="hardware"><span class="pill">Hardware e sistema</span><h2 class="t">O que há dentro da máquina</h2><p class="sub">Cada cartão explica o que a peça faz e mostra seus números atuais.</p><div class="grid" id="cards"></div></section>

<section class="s" id="maquina"><span class="pill">Raio-X avançado</span><h2 class="t">Detalhes da máquina</h2><p class="sub">CPU, núcleos, threads, RAM, VRAM, consumo de energia e temperaturas, tudo o que o sistema consegue informar.</p><div class="grid" id="maq"></div></section>

<section class="s" id="processos"><span class="pill">Processos</span><h2 class="t">O que está rodando agora</h2><p class="sub">Cada programa aberto é um processo. Veja quem usa mais processador e memória.</p>
<div class="card" style="text-align:left"><div id="pres" style="margin-bottom:12px"></div>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><input id="busca" placeholder="Buscar por nome, usuário ou PID..."><button class="f on" data-o="memMB">Mais memória</button><button class="f" data-o="cpu">Mais CPU</button><button class="f" data-o="pid">PID</button></div>
<div class="scroll"><table><thead><tr><th>PID</th><th>Programa</th><th>Usuário</th><th>CPU %</th><th>Memória</th><th>Threads</th><th>Estado</th><th>Ativo há</th></tr></thead><tbody id="tb"></tbody></table></div></div></section>
<footer>Raio-X do Computador · dados lidos localmente na sua máquina</footer>

<script>
const $=s=>document.querySelector(s);let D=null,ord='memMB';
const cor=p=>p>=90?'#ef4444':p>=70?'#f59e0b':'#22c55e';
const bar=(p,c)=>'<div class="bar"><i style="width:'+Math.min(p,100)+'%;background:'+(c||cor(p))+'"></i></div>';
const esc=s=>String(s??'-').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const tr=(k,v,a)=>'<tr><td>'+k+(a?'<small>'+a+'</small>':'')+'</td><td>'+esc(v)+'</td></tr>';
const card=(i,t,e,b)=>'<div class="card"><div class="ic">'+i+'</div><h3>'+t+'</h3><p class="exp">'+e+'</p>'+b+'</div>';
const estado={R:'Trabalhando',S:'Dormindo (normal)',Z:'Travado (zumbi)',T:'Pausado',D:'Aguardando disco',I:'Ocioso'};

function diag(d){const c=d.cpu.usoTotal,m=d.memoria.pct,disco=d.discos.slice().sort((a,b)=>b.pct-a.pct)[0],t=d.maquina.cpu.tempC,p=d.processos;
 const nv=(v,a,b)=>v>=b?'erro':v>=a?'aviso':'ok',rot={ok:'Tudo certo',aviso:'Atenção',erro:'Crítico'};
 const it=[
 ['🧠','Processador',c+'% em uso. '+(c>=90?'Sobrecarregado, pode estar lento.':c>=70?'Bem ocupado agora.':'Funcionando tranquilo.'),nv(c,70,90),c],
 ['🧩','Memória RAM',m+'% em uso. '+(m>=90?'Quase cheia, feche programas.':m>=75?'Fique de olho.':'Com bastante espaço livre.'),nv(m,75,90),m]];
 if(disco)it.push(['💾','Armazenamento',disco.pct+'% usado em "'+disco.nome.trim()+'". '+(disco.pct>=90?'Quase cheio.':disco.pct>=75?'Começando a encher.':'Espaço de sobra.'),nv(disco.pct,75,90),disco.pct]);
 if(t!=null)it.push(['🌡️','Temperatura da CPU',t+' °C. '+(t>=85?'Muito quente.':t>=70?'Um pouco alta.':'Dentro do normal.'),nv(t,70,85),Math.min(t,100)]);
 if(d.bateria)it.push(['🔋','Bateria',d.bateria.pct+'%. '+(d.bateria.carregando?'Carregando.':d.bateria.pct<=20?'Baixa, conecte o carregador.':'Usando bateria.'),d.bateria.pct<=20&&!d.bateria.carregando?'aviso':'ok',null]);
 it.push(['⚙️','Processos',p.total+' em execução. '+(p.zumbis>0?p.zumbis+' travado(s) (zumbi).':'Nenhum travado.'),p.zumbis>0?'aviso':'ok',null]);
 return it.map(x=>'<div class="feat"><div class="tl">'+x[0]+'</div><div class="ft"><h4>'+x[1]+'<span class="st '+x[3]+'"><i></i>'+rot[x[3]]+'</span></h4><p>'+x[2]+'</p>'+(x[4]!=null?bar(x[4]):'')+'</div></div>').join('')}

function render(d){$('#hora').textContent=d.hora;$('#diag').innerHTML=diag(d);const s=d.sistema,c=d.cpu,m=d.memoria;
 $('#ring').style.background='conic-gradient('+cor(c.usoTotal)+' '+c.usoTotal*3.6+'deg,#262626 0)';$('#ringn').textContent=c.usoTotal+'%';
 const ch=[['Sistema',s.sistemaOperacional],['Processador',c.modelo.replace(/\(R\)|\(TM\)|CPU/g,'').split('@')[0]],['Núcleos',c.nucleos],['Memória',m.totalGB+' GB'],['Ligado há',s.ligadoHa]];
 if(d.gpu[0])ch.splice(3,0,['Vídeo',d.gpu[0].nome.slice(0,32)]);
 $('#chips').innerHTML=ch.map(x=>'<div><i>'+x[0]+'</i>'+esc(x[1])+'</div>').join('');
 let h='';
 h+=card('💻','Seu computador','Dados gerais: qual sistema roda nele e há quanto tempo está ligado.','<table>'+tr('Sistema operacional',s.sistemaOperacional,'O "programa principal" que controla a máquina')+tr('Nome na rede',s.nomeDoComputador)+tr('Usuário',s.usuario)+tr('Ligado há',s.ligadoHa,'Desde a última inicialização')+tr('Arquitetura',s.arquitetura,'x64 = 64 bits, arm64 = chip ARM')+tr('Kernel',s.versaoKernel)+tr('Fuso / idioma',s.fusoHorario+' · '+s.idioma)+'</table>');
 h+=card('🏭','Fabricante e placa-mãe','A placa-mãe é a base onde as peças se conectam. A BIOS liga o hardware.','<table>'+tr('Fabricante',d.placa.fabricante)+tr('Modelo',d.placa.modelo)+tr('Placa-mãe',d.placa.placaMae)+tr('BIOS',d.placa.bios)+'</table>');
 h+=card('🧠','Processador (CPU)','O "cérebro" do computador. Núcleos são vários cérebros trabalhando juntos.','<div class="big">'+c.usoTotal+'%</div>'+bar(c.usoTotal)+'<table>'+tr('Modelo',c.modelo)+tr('Núcleos lógicos',c.nucleos,'Tarefas em paralelo')+tr('Velocidade',c.mhz+' MHz','Quanto maior, mais rápido (aprox.)')+(c.carga?tr('Carga (1/5/15 min)',c.carga.m1+' / '+c.carga.m5+' / '+c.carga.m15,'Acima do nº de núcleos = fila'):'')+'</table><p class="exp" style="margin:12px 0 6px">Uso por núcleo</p><div class="nuc">'+c.usoPorNucleo.map((u,i)=>'<div>#'+i+' '+u+'%'+bar(u)+'</div>').join('')+'</div>');
 h+=card('🧩','Memória RAM','A "mesa de trabalho": guarda o que está em uso agora. Se encher, tudo fica lento.','<div class="big">'+m.pct+'%</div>'+bar(m.pct)+'<table>'+tr('Total',m.totalGB+' GB')+tr('Em uso',m.usadaGB+' GB')+tr('Livre',m.livreGB+' GB')+tr('Usada por este painel',m.nodeMB+' MB')+'</table>');
 h+=card('💾','Discos','Onde seus arquivos ficam guardados, mesmo com o PC desligado.',d.discos.map(x=>'<b style="color:#fff">'+esc(x.nome)+'</b> <span class="tag">'+esc(x.formato)+'</span>'+bar(x.pct)+'<small class="exp">'+x.livreGB+' GB livres de '+x.totalGB+' GB ('+x.pct+'% usado)</small><br><br>').join('')||'Nenhum disco encontrado');
 h+=card('🎮','Placa de vídeo (GPU)','Cuida de imagens, jogos, vídeos e telas.',d.gpu.length?'<table>'+d.gpu.map(g=>tr(g.nome,(g.memoriaGB?g.memoriaGB+' GB':'')+(g.driver?' · driver '+g.driver:''))).join('')+'</table>':'<span class="exp">Não detectada</span>');
 if(d.bateria)h+=card('🔋','Bateria','Quanto de energia resta e se está carregando.','<div class="big">'+d.bateria.pct+'%</div>'+bar(d.bateria.pct,d.bateria.pct<=20?'#ef4444':'#22c55e')+(d.bateria.carregando?'⚡ Carregando':'Usando bateria'));
 if(d.temperaturas.length)h+=card('🌡️','Temperaturas','Calor das peças. Acima de 85 °C é preocupante.','<table>'+d.temperaturas.map(t=>tr(t.sensor,t.c+' °C')).join('')+'</table>');
 h+=card('🌐','Rede','IP é o "endereço" do computador; MAC é o "número de série" da placa de rede.','<div class="scroll" style="max-height:260px"><table>'+d.rede.map(r=>tr(r.nome+' <span class="tag">'+r.tipo+(r.local?' · interno':'')+'</span>',r.ip,'MAC: '+r.mac)).join('')+'</table></div>');
 h+=card('🚪','Portas abertas','Programas "escutando" conexões. Algumas são normais; desconhecidas merecem atenção.','<div class="scroll" style="max-height:260px"><pre>'+esc(d.portas.join('\n')||'Sem dados')+'</pre></div>');
  const q=d.maquina,cp=q.cpu,mm=q.memoria,en=q.energia;let k='';
 const rows=a=>a.filter(r=>r[1]!=null&&r[1]!==''&&!String(r[1]).includes('NaN')).map(r=>tr(r[0],r[1],r[2])).join('');
 const tc=c=>c==null?'<span class="exp">indisponível</span>':'<b style="color:'+cor(c/1.1)+'">'+c+' °C</b>';
 const mhz=v=>v?Math.round(v)+' MHz':null,w=v=>v==null?null:v+' W',vel=b=>b>=1048576?(b/1048576).toFixed(2)+' MB/s':(b/1024).toFixed(1)+' KB/s';
 k+=card('🧠','Processador em detalhe','Quantos chips, núcleos e threads existem e como estão trabalhando agora.','<table>'+rows([['Modelo',cp.modelo],['Fabricante',cp.fabricante],['Processadores físicos (soquetes)',cp.soquetes,'Chips instalados na placa-mãe'],['Núcleos físicos',cp.nucleosFisicos,'Os "cérebros" reais do chip'],['Threads (núcleos lógicos)',cp.threads,'Tarefas simultâneas'],['Threads por núcleo',cp.threadsPorNucleo,'2 = Hyper-Threading / SMT'],['Frequência atual',mhz(cp.atualMHz)],['Frequência máxima',mhz(cp.maxMHz)],['Frequência mínima',mhz(cp.minMHz)],['Cache L1 (dados)',cp.cache&&cp.cache.l1d],['Cache L1 (instruções)',cp.cache&&cp.cache.l1i],['Cache L2',cp.cache&&cp.cache.l2],['Cache L3',cp.cache&&cp.cache.l3,'Memória ultrarrápida dentro do chip'],['Virtualização',cp.virtualizacao],['Potência consumida',w(cp.watts)]])+'<tr><td>Temperatura</td><td>'+tc(cp.tempC)+'</td></tr></table>');
 if(q.gpus.length)q.gpus.forEach((g,i)=>{const vp=g.vramTotalMB&&g.vramUsadaMB!=null?+(100*g.vramUsadaMB/g.vramTotalMB).toFixed(1):null;
  k+=card('🎮','GPU '+(i+1)+': '+esc(g.nome),'Placa de vídeo. VRAM é a memória exclusiva dela, usada em jogos, vídeos e IA.',(vp!=null?'<div class="big">'+vp+'%</div>'+bar(vp)+'<p class="exp">VRAM: '+g.vramUsadaMB+' MB usados de '+g.vramTotalMB+' MB</p>':'')+'<table>'+rows([['Fabricante',g.fabricante],['Uso da GPU',g.uso!=null?g.uso+'%':null],['VRAM total',g.vramTotalMB?(g.vramTotalMB/1024).toFixed(1)+' GB':null],['Potência',g.watts!=null?g.watts+' W'+(g.wattsLimite?' / limite '+g.wattsLimite+' W':''):null],['Clock do núcleo',mhz(g.clockMHz)],['Clock da memória',mhz(g.clockMemMHz)],['Ventoinha',g.ventoinhaPct!=null?g.ventoinhaPct+'%':null],['Modo de energia',g.estado],['Driver',g.driver]])+'<tr><td>Temperatura</td><td>'+tc(g.tempC)+'</td></tr></table>')});
 else k+=card('🎮','GPU em detalhe','Telemetria de VRAM, uso, temperatura e potência.','<p class="exp">Nenhuma GPU com telemetria detectada. Em placas NVIDIA é preciso o driver (nvidia-smi); AMD/Intel só funcionam no Linux.</p>');
 const sp=mm.swapTotalGB?+(100*mm.swapUsadoGB/mm.swapTotalGB).toFixed(1):null;
 k+=card('🧩','Memória em detalhe','RAM é a mesa de trabalho. Swap é um "puxadinho" no disco usado quando a RAM enche (bem mais lento).','<table>'+rows([['RAM total',d.memoria.totalGB+' GB'],['Em uso',d.memoria.usadaGB+' GB'],['Realmente disponível',mm.disponivelGB!=null?mm.disponivelGB+' GB':null,'Inclui cache que pode ser liberado'],['Cache de arquivos',mm.cacheGB!=null?mm.cacheGB+' GB':null],['Buffers',mm.buffersGB!=null?mm.buffersGB+' GB':null],['Compartilhada',mm.compartilhadaGB!=null?mm.compartilhadaGB+' GB':null]])+'</table>'+(sp!=null?'<p class="exp" style="margin:12px 0 0">Swap: '+mm.swapUsadoGB+' GB de '+mm.swapTotalGB+' GB</p>'+bar(sp):''));
 k+=card('🔌','Pentes de memória','Cada módulo físico de RAM instalado na placa-mãe.',mm.pentes.length?'<table><thead><tr><th>Slot</th><th>Tamanho</th><th>Tipo</th><th>Velocidade</th></tr></thead>'+mm.pentes.map(p=>'<tr><td>'+esc(p.slot)+'</td><td>'+p.tamanhoGB+' GB</td><td>'+esc(p.tipo)+'</td><td>'+esc(p.velocidade)+'</td></tr>').join('')+'</table>':'<p class="exp">Não disponível. No Linux exige o comando dmidecode com permissão de administrador; no macOS não é exposto.</p>');
 const gW=en.gpuW;
 k+=card('⚡','Consumo de energia','Quantos watts (W) as peças estão puxando agora.','<table>'+rows([['CPU',w(en.cpuW),'Linux com Intel/AMD RAPL'],['GPU',w(gW)],['Bateria (descarga)',w(en.bateriaW)]])+q.sensores.potencias.map(p=>tr(p.chip+' · '+p.sensor,p.w+' W')).join('')+'</table>'+(en.cpuW==null&&gW==null&&en.bateriaW==null&&!q.sensores.potencias.length?'<p class="exp">Nenhum sensor de potência acessível. No Linux, dar permissão de leitura em /sys/class/powercap libera o consumo da CPU.</p>':''));
 const gt=q.gpus.map(g=>g.tempC).find(x=>x!=null);
 k+=card('🌡️','Temperaturas','Calor das peças. Até ~70 °C é normal; acima de 85 °C é preocupante.','<div style="display:flex;gap:32px"><div><div class="big">'+(cp.tempC??'--')+'°</div><p class="exp">CPU</p></div><div><div class="big">'+(gt??'--')+'°</div><p class="exp">GPU</p></div></div>'+(q.sensores.temperaturas.length?'<div class="scroll" style="max-height:240px"><table>'+q.sensores.temperaturas.map(t=>'<tr><td>'+esc(t.chip)+' · '+esc(t.sensor)+'</td><td>'+tc(t.c)+'</td></tr>').join('')+'</table></div>':'<p class="exp">Sensores extras indisponíveis neste sistema (no Windows a temperatura da CPU pode exigir administrador).</p>'));
 if(q.sensores.ventoinhas.length)k+=card('🌀','Ventoinhas','Velocidade do cooler em rotações por minuto (RPM).','<table>'+q.sensores.ventoinhas.map(v=>tr(v.chip+' · '+v.sensor,v.rpm+' RPM')).join('')+'</table>');
 if(q.rede)k+=card('📶','Tráfego de rede agora','Quanto está sendo baixado e enviado neste momento.','<table>'+tr('⬇️ Download',vel(q.rede.rx))+tr('⬆️ Upload',vel(q.rede.tx))+'</table>');
 $('#maq').innerHTML=k;
 $('#cards').innerHTML=h;const p=d.processos;
 $('#pres').innerHTML='<span class="tag">'+p.total+' processos</span><span class="tag">'+p.rodando+' trabalhando</span><span class="tag">'+p.zumbis+' zumbis</span>';tabela()}

function tabela(){if(!D)return;const q=$('#busca').value.toLowerCase();
 const l=D.processos.lista.filter(p=>(p.nome+p.usuario+p.pid).toLowerCase().includes(q)).sort((a,b)=>ord=='pid'?a.pid-b.pid:b[ord]-a[ord]).slice(0,150);
 $('#tb').innerHTML=l.map(p=>'<tr><td>'+p.pid+'</td><td><b>'+esc(p.nome)+'</b></td><td>'+esc(p.usuario)+'</td><td>'+p.cpu+'</td><td>'+(p.memMB>=1024?(p.memMB/1024).toFixed(2)+' GB':p.memMB+' MB')+'</td><td>'+esc(p.threads)+'</td><td>'+esc(estado[p.estado[0]]||p.estado)+'</td><td>'+esc(p.tempo)+'</td></tr>').join('')}

$('#busca').oninput=tabela;
document.querySelectorAll('button[data-o]').forEach(b=>b.onclick=()=>{ord=b.dataset.o;document.querySelectorAll('button[data-o]').forEach(x=>x.classList.toggle('on',x==b));tabela()});
async function atualizar(){try{D=await (await fetch('/api/all')).json();render(D)}catch(e){$('#diag').innerHTML='<div class="alert erro">Falha ao carregar: '+e.message+'</div>'}}
atualizar();setInterval(atualizar,3000);
</script></body></html>`;