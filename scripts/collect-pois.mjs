#!/usr/bin/env node
/** Reproducible OSM collection. Node 20+, no dependencies. Run from project root. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bbox = [51.07, 71.36, 51.19, 71.50]; // South, west, north, east; central Astana + EXPO.
const query = `[out:json][timeout:35];(
  nwr[amenity=cafe](${bbox.join(',')});
  nwr[leisure~"^(park|playground)$"](${bbox.join(',')});
  nwr[tourism~"^(museum|attraction|viewpoint|artwork)$"](${bbox.join(',')});
  nwr[shop=mall](${bbox.join(',')});
  nwr[historic~"^(monument|memorial)$"](${bbox.join(',')});
  nwr[amenity=exhibition_centre](${bbox.join(',')});
  nwr[museum=future](${bbox.join(',')});
);out center tags;`;
const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const attempts = [];
let data, endpoint;
for (const url of process.argv.includes('--map') ? [] : endpoints) {
  try {
    console.log(`Collecting OSM POIs from ${url}`);
    const response = await fetch(url, {
      method: 'POST', body: new URLSearchParams({ data: query }),
      headers: { 'User-Agent': 'Qadam-Hackathon-POI-Collector/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(48000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.elements) || !result.elements.length) throw new Error(result.remark || 'Empty result');
    data = result; endpoint = url; attempts.push({ endpoint: url, success: true }); break;
  } catch (error) { attempts.push({ endpoint: url, success: false, error: error.message }); console.error(error.message); }
}
let mapBoxes = [];
if (!data) {
  // Official map API fallback; bounded tiles avoid the 50,000-node limit.
  const centers = [[51.128,71.430],[51.132,71.404],[51.128,71.418],[51.128,71.442],
    [51.108,71.423],[51.090,71.415],[51.087,71.404],[51.098,71.413],
    [51.118,71.470],[51.124,71.463],[51.160,71.430],[51.166,71.420],
    [51.172,71.426],[51.155,71.438],[51.142,71.421],[51.116,71.438]];
  mapBoxes = centers.map(([lat,lon])=>[lon-.008,lat-.005,lon+.008,lat+.005]);
  const elements = new Map();
  for (const box of mapBoxes) {
    const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${box.join(',')}`;
    try {
      console.log(`Fetching official OSM map tile ${box.join(',')}`);
      const response = await fetch(url, {headers:{'User-Agent':'Qadam-Hackathon-POI-Collector/1.0'},signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      for (const e of result.elements || []) elements.set(`${e.type}-${e.id}`,e);
      attempts.push({endpoint:url,success:true,elements:result.elements?.length});
    } catch(error) { attempts.push({endpoint:url,success:false,error:error.message}); }
  }
  const isPOI = t => t && (t.amenity==='cafe' || ['park','playground'].includes(t.leisure) ||
    ['museum','attraction','viewpoint','artwork'].includes(t.tourism) || t.shop==='mall' || ['monument','memorial'].includes(t.historic) || t.amenity==='exhibition_centre' || t.museum==='future');
  const selected = [...elements.values()].filter(e=>isPOI(e.tags));
  for (const e of selected) {
    if (e.type==='way') {
      const nodes = (e.nodes || []).map(id=>elements.get(`node-${id}`)).filter(Boolean);
      if(nodes.length) e.center={lat:(Math.min(...nodes.map(n=>n.lat))+Math.max(...nodes.map(n=>n.lat)))/2,
        lon:(Math.min(...nodes.map(n=>n.lon))+Math.max(...nodes.map(n=>n.lon)))/2};
    }
  }
  if(selected.length) { data={elements:selected}; endpoint='https://api.openstreetmap.org/api/0.6/map.json'; }
}
if (!data) throw new Error('Live OSM collection failed. Existing snapshot has not been replaced.');

const fetchedAt = new Date().toISOString();
const categoryOf = t => t.amenity === 'cafe' ? 'cafe' : t.leisure === 'park' ? 'park' :
  t.leisure === 'playground' ? 'playground' : t.tourism === 'museum' ? 'museum' : t.shop === 'mall' ? 'mall' : 'landmark';
const labels = { cafe:'Кафе', park:'Парк', playground:'Детская площадка', museum:'Музей', mall:'Торговый центр', landmark:'Достопримечательность' };
const seen = new Set();
const candidates = data.elements.flatMap(element => {
  const t = element.tags || {};
  const name = t['name:ru'] || t.name || t['name:en'] || t['name:kk'];
  const lat = element.lat ?? element.center?.lat, lon = element.lon ?? element.center?.lon;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const key = `${name.toLowerCase()}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const category = categoryOf(t);
  const tags = [category];
  if (t.cuisine) tags.push(...t.cuisine.split(';'));
  if (t.outdoor_seating === 'yes') tags.push('outdoor_seating');
  if (t.internet_access && t.internet_access !== 'no') tags.push('internet_access');
  if (t.wheelchair === 'yes') tags.push('wheelchair');
  if (t.tourism === 'viewpoint') tags.push('viewpoint');
  if (t.tourism === 'artwork') tags.push('artwork');
  if (t.historic) tags.push(t.historic);
  if (t.amenity==='exhibition_centre') tags.push('exhibition_centre');
  if (t.museum==='future') tags.push('future_museum');
  const details = [`${labels[category]} в Астане по данным OpenStreetMap.`];
  if (t.museum==='future') details.push('В OSM указан тег museum=future и офисное использование; действующая музейная экспозиция и доступ для посещения не подтверждены.');
  if (t.amenity==='exhibition_centre') details.push('Выставочный центр; актуальная программа и доступ требуют проверки.');
  if (t['addr:street']) details.push(`Адрес: ${t['addr:street']}${t['addr:housenumber'] ? ', ' + t['addr:housenumber'] : ''}.`);
  if (t.cuisine) details.push(`Кухня в источнике: ${t.cuisine.replaceAll(';', ', ')}.`);
  if (t.outdoor_seating === 'yes') details.push('В источнике указаны места на открытом воздухе.');
  if (t.internet_access && t.internet_access !== 'no') details.push(`Интернет в источнике: ${t.internet_access}. Наличие розеток не подтверждено.`);
  if (t.description) details.push(t.description);
  return [{ id: `osm-${element.type}-${element.id}`, name, lat, lon, category, tags,
    description: details.join(' '), openingHours: t.opening_hours || null,
    wheelchair: t.wheelchair || null, website: t.website || t['contact:website'] || null,
    phone: t.phone || t['contact:phone'] || null,
    source: `https://www.openstreetmap.org/${element.type}/${element.id}`, fetchedAt,
    osmTags: t, coordinateType: element.center ? 'geometry-center' : 'node',
  }];
}).sort((a,b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ru'));

// Merge same-category aliases within 50m, preferring richer records (hours/contacts).
// Alias comparison only uses names published on OSM, not invented translations.
const aliases = p => Object.entries(p.osmTags).filter(([k])=>k==='name'||k.startsWith('name:'))
  .map(([,v])=>v.toLowerCase().replace(/astana|астана/g,'').replace(/[^\p{L}\p{N}]/gu,''));
const pois = [];
for (const poi of candidates.sort((a,b)=>Object.keys(b.osmTags).length-Object.keys(a.osmTags).length)) {
  const names=aliases(poi);
  const duplicate=pois.find(p=>p.category===poi.category &&
    Math.hypot((p.lat-poi.lat)*111320,(p.lon-poi.lon)*69800)<50 && aliases(p).some(n=>names.includes(n)));
  if(duplicate) (duplicate.additionalSources ||= []).push(poi.source); else pois.push(poi);
}
pois.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name,'ru'));

// Named POIs only; no synthetic points or inferred amenities.
const counts = Object.fromEntries([...new Set(pois.map(p=>p.category))].map(c=>[c,pois.filter(p=>p.category===c).length]));
const meta = { source:mapBoxes.length ? 'OpenStreetMap official map API (Overpass fallback)' : 'OpenStreetMap via Overpass API', endpoint, mapBoxes, license:'ODbL 1.0',
  licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/', attribution:'© OpenStreetMap contributors',
  attributionUrl:'https://www.openstreetmap.org/copyright', fetchedAt,
  osmBaseTimestamp:data.osm3s?.timestamp_osm_base || null, bbox,
  count:pois.length, categoryCounts:counts, deduplication:'Exact published name aliases within 50 metres, same category; richer OSM record retained.', descriptionMethod:'Deterministic Russian text from OSM tags; no unverified enrichment.',
  limitations:['OSM coverage and opening hours may be incomplete or outdated.', 'Way/relation coordinates are geometry centers, not verified entrances.', 'Noise levels, power outlets, prices, current events and live opening status are not verified.'], query };
await mkdir(path.join(root,'dist','data'), {recursive:true});
await writeFile(path.join(root,'dist','data','pois.json'), JSON.stringify({meta,pois},null,2)+'\n');
await writeFile(path.join(root,'dist','data','collection-report.json'), JSON.stringify({fetchedAt,attempts,rawElements:data.elements.length,namedPois:pois.length,categoryCounts:counts,query},null,2)+'\n');
console.log(JSON.stringify({count:pois.length,categoryCounts:counts,output:path.join(root,'dist','data','pois.json')},null,2));
