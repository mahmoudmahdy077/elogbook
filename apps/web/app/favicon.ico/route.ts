import { NextResponse } from 'next/server';

const SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
  <line x1="8" y1="7" x2="16" y2="7" stroke-width="1.5"/>
  <line x1="8" y1="10" x2="14" y2="10" stroke-width="1.5"/>
</svg>`;

export async function GET() {
  return new NextResponse(SVG_ICON, {
    headers: { 'Content-Type': 'image/svg+xml' },
  });
}
