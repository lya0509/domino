const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');
const swSourcePath = path.join(__dirname, '..', 'public', 'sw.js');
const swDestPath = path.join(distDir, 'sw.js');

if (fs.existsSync(swSourcePath) && fs.existsSync(distDir)) {
  fs.copyFileSync(swSourcePath, swDestPath);
  console.log('✅ Postbuild: Service Worker copied to dist/sw.js');
}

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  const pwaTags = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icon.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="PeSiMistas" />
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('/sw.js').catch(function () {});
        });
      }
    </script>
  `;

  if (!html.includes('rel="manifest"')) {
    html = html.replace('</head>', `${pwaTags}</head>`);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log('✅ Postbuild: High-resolution icons, PWA manifest, and Offline Service Worker injected into dist/index.html');
  } else {
    console.log('ℹ️ Postbuild: dist/index.html already contains manifest link.');
  }
} else {
  console.log('⚠️ Postbuild: dist/index.html not found.');
}
