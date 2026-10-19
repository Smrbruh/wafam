export const categories={cafe:'Кофе и пауза',park:'Парки',museum:'Музеи',landmark:'Архитектура',mall:'В помещении',playground:'С детьми'};
export const visits={cafe:20,park:25,museum:45,landmark:15,mall:30,playground:25};
export function distance(a,b){const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;return 6371*2*Math.atan2(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2),Math.sqrt(1-(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2)));}
const synonyms={cafe:['коф','каф','cafe','coffee','розет','работ','тих'],park:['парк','прогул','зел','сад','walk','park','свеж'],museum:['музе','museum','выстав','интерактив','истор'],landmark:['архит','турист','необыч','фото','достопр','вид','tourist'],mall:['тепл','помещ','дожд','холод','торгов','indoor'],playground:['реб','дет','семь','family','child','площад']};
export function tokens(s){return String(s).toLowerCase().replace(/ё/g,'е').match(/[\p{L}\p{N}]+/gu)||[];}
function expanded(s){const ts=tokens(s);for(const [cat,words]of Object.entries(synonyms))if(words.some(w=>ts.some(t=>t.startsWith(w))))ts.push(cat);return ts;}
export function retrieve(pois,options){
 const {origin,minutes=60,radius=3,query='',category='all',indoor=false,accessible=false,night=false}=options;
 if(!origin||![origin.lat,origin.lon].every(Number.isFinite)||!Number.isFinite(+minutes)||+minutes<=0||!Number.isFinite(+radius)||+radius<=0)throw new Error('Некорректные параметры поиска');
 const docs=pois.map(p=>expanded([p.name,p.description,p.category,...(p.tags||[])].join(' '))),df=new Map();docs.forEach(ts=>new Set(ts).forEach(t=>df.set(t,(df.get(t)||0)+1)));
 const q=expanded(query),intent=new Set(q.filter(t=>categories[t]));let excluded={distance:0,time:0,category:0,accessibility:0,context:0};
 const ranked=pois.flatMap((p,i)=>{const km=distance(origin,p),walk=Math.max(1,Math.ceil(km*1.3/4.5*60)),visit=visits[p.category]||20;
 if(km>+radius){excluded.distance++;return [];}if(walk+visit>+minutes){excluded.time++;return [];}if(category!=='all'&&p.category!==category){excluded.category++;return [];}if(accessible&&p.wheelchair!=='yes'){excluded.accessibility++;return [];}
 if((indoor&&!['cafe','museum','mall'].includes(p.category))||(night&&['park','playground'].includes(p.category))){excluded.context++;return [];}
 const ts=docs[i],tf=new Map();ts.forEach(t=>tf.set(t,(tf.get(t)||0)+1));let lexical=0;q.forEach(t=>{if(tf.has(t))lexical+=(1+Math.log(tf.get(t)))*Math.log(1+(pois.length+1)/((df.get(t)||0)+1));});
 const intentBonus=intent.has(p.category)?6:0;const score=lexical+intentBonus+2/(1+km);return [{...p,km,walk,visit,total:walk+visit,score:+score.toFixed(3),lexical:+lexical.toFixed(3),intentMatch:intent.has(p.category)}];
 }).sort((a,b)=>b.score-a.score||a.km-b.km);
 // A specific intent should not silently be replaced by unrelated places.
 const relevant=intent.size&&category==='all'?ranked.filter(p=>intent.has(p.category)):ranked;
 return {results:relevant.slice(0,3),candidates:relevant.length,excluded,total:pois.length,queryTokens:q,mode:'local'};
}
export function explain(p,query=''){const why=p.intentMatch?'Совпадает с вашим запросом':`Подходит для короткой остановки: ${categories[p.category]?.toLowerCase()||'интересное место'}`;const action={cafe:'Сделайте паузу на напиток. Тишину и наличие розетки уточните у сотрудников.',park:'Пройдите по доступным дорожкам и выберите место для короткой остановки.',museum:'Уточните часы и билеты, затем выберите одну экспозицию.',landmark:'Рассмотрите архитектуру с общедоступной территории и сделайте фото.',mall:'Зайдите погреться и сделайте короткую паузу в общественной зоне.',playground:'Осмотрите площадку и выберите подходящую ребёнку активность.'}[p.category];return {why:`${why}; ориентировочно ${p.walk} мин пешком.`,action,uncertainty:p.openingHours?`В OSM указано: ${p.openingHours}. Актуальность не подтверждена.`:'Часы работы неизвестны — уточните перед выходом.'};}
export function itinerary(selected,origin,budget){let at=origin,total=0,stops=[];for(const p of selected){const walk=Math.max(1,Math.ceil(distance(at,p)*1.3/4.5*60)),visit=visits[p.category]||20;if(total+walk+visit>budget)continue;stops.push({...p,legWalk:walk,visit});total+=walk+visit;at=p;}return {stops,total,remaining:budget-total};}
