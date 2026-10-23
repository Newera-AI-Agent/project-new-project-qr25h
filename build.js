const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy all vulnerability reports and summary documents
const files = [
  'vurn1.md',
  'vurn2.md',
  'vurn3.md',
  'vurn4.md',
  'vurn5.md',
  'vurn6.md',
  'vurn7.md',
  'vurn8.md',
  'vurn9.md',
  'ENGAGEMENT_REPORT.md',
  'VULNERABILITY_INDEX.md',
  'README.md'
];

files.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file} to dist/`);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
});

// Create index.html
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pollinations Security Audit - Vulnerability Reports</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; background: #0d1117; color: #e6edf3; }
        h1 { color: #f85149; border-bottom: 1px solid #30363d; padding-bottom: 1rem; }
        .vuln { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
        .vuln h2 { color: #ff7b72; margin-top: 0; }
        .severity { display: inline-block; background: #f85149; color: white; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.875rem; font-weight: bold; }
        a { color: #58a6ff; }
        pre { background: #0d1117; border: 1px solid #30363d; padding: 1rem; overflow-x: auto; }
        code { font-family: 'SF Mono', Monaco, monospace; font-size: 0.875rem; }
        .meta { color: #8b949e; font-size: 0.875rem; }
    </style>
</head>
<body>
    <h1>🔒 Pollinations Security Audit</h1>
    <p class="meta">Critical Vulnerability Reports | Generated 2026-10-23</p>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-1: Auth Bypass via Text Cache</h2>
        <p><strong>Endpoints:</strong> /text, /v1/chat/completions, /v1/embeddings</p>
        <p><strong>Root Cause:</strong> text-cache.ts:27-70 - Missing Authorization header in cache key</p>
        <p><a href="vurn1.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-2: Auth Bypass via Media Cache</h2>
        <p><strong>Endpoints:</strong> /image, /v1/images/*, /v1/audio/*</p>
        <p><strong>Root Cause:</strong> media-cache.ts:27-70 - Missing Authorization header in cache key</p>
        <p><a href="vurn2.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-3: Auth Bypass on Chat Completions</h2>
        <p><strong>Endpoints:</strong> /v1/chat/completions</p>
        <p><a href="vurn3.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-4: Auth Bypass on Model Listing</h2>
        <p><strong>Endpoints:</strong> /v1/models</p>
        <p><a href="vurn4.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-5: Auth Bypass on Embeddings</h2>
        <p><strong>Endpoints:</strong> /v1/embeddings</p>
        <p><a href="vurn5.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-6: Auth Bypass on Audio Endpoints</h2>
        <p><strong>Endpoints:</strong> /v1/audio/*</p>
        <p><a href="vurn6.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-7: Additional Cache Auth Bypass Variant</h2>
        <p><a href="vurn7.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-8: Auth Bypass on Image Generation via Cache Poisoning</h2>
        <p><strong>Endpoints:</strong> /image, /v1/images/generations, /v1/images/edits, /v1/images/variations</p>
        <p><strong>Root Cause:</strong> media-cache.ts:27-70 - Missing Authorization header in cache key</p>
        <p><a href="vurn8.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2><span class="severity">CRITICAL</span> VURN-9: Rate Limiting Bypass via Cache Key Manipulation</h2>
        <p><strong>Endpoints:</strong> All cached endpoints</p>
        <p><strong>Root Cause:</strong> Cache keys exclude rate limit identity/user tier</p>
        <p><a href="vurn9.md">View Full Report →</a></p>
    </div>
    
    <div class="vuln">
        <h2>📋 Summary Documents</h2>
        <ul>
            <li><a href="ENGAGEMENT_REPORT.md">Executive Engagement Report</a></li>
            <li><a href="VULNERABILITY_INDEX.md">Vulnerability Index</a></li>
        </ul>
    </div>
    
    <p class="meta">CVSS 3.1: 9.1 (Critical) | AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N</p>
</body>
</html>`;

fs.writeFileSync(path.join(distDir, 'index.html'), indexHtml);
console.log('Created dist/index.html');
console.log('Build complete!');
