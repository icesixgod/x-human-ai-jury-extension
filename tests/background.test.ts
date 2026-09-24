import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answer, snapshot } from './fixtures';
import { reviewId, tally } from '../shared/contracts';

type Area = ReturnType<typeof storage>;
function storage() {
  const values:Record<string,unknown>={};
  return {values,get:vi.fn(async(key:string)=>({[key]:values[key]})),set:vi.fn(async(data:Record<string,unknown>)=>{Object.assign(values,structuredClone(data));}),remove:vi.fn(async(key:string)=>{delete values[key];}),setAccessLevel:vi.fn(async()=>{})};
}
const id='a'.repeat(32);
const settings={id,url:`chrome-extension://${id}/options.html`};
const content={id,url:'https://x.com/user/status/10001',frameId:0,tab:{id:1}};
let local:Area,session:Area,listener:(message:unknown,sender:any,callback:(v:any)=>void)=>void,fetcher:ReturnType<typeof vi.fn>,online:boolean,granted:boolean;
async function boot() {
  vi.resetModules();
  vi.stubGlobal('chrome',{storage:{local,session},runtime:{id,onMessage:{addListener:(fn:typeof listener)=>{listener=fn;}},onStartup:{addListener:vi.fn()},onInstalled:{addListener:vi.fn()},openOptionsPage:vi.fn(async()=>{})},
    permissions:{contains:vi.fn(async()=>granted)},alarms:{onAlarm:{addListener:vi.fn()},create:vi.fn()},action:{onClicked:{addListener:vi.fn()}}});
  await import('../extension/background');
}
function send(data:unknown,sender=settings):Promise<any>{return new Promise(resolve=>listener(data,sender,resolve));}
beforeEach(async()=>{
  local=storage();session=storage();online=false;granted=true;
  fetcher=vi.fn(async(input:string|Request|URL,options?:RequestInit)=>{
    const url=String(input);
    if(!url.startsWith('https://api.typesafe.ai/')&&!url.startsWith('https://x.aileetcode.com/'))throw new Error('Unexpected outgoing request');
    if(url.startsWith('https://api.typesafe.ai/'))return Response.json(answer);
    if(!online)return new Response(JSON.stringify({error:'unavailable'}),{status:503});
    const body=JSON.parse(String(options?.body));
    const state={review:{id:await reviewId(snapshot),snapshot,tally:tally(body.vote==='human'?1:0,body.vote==='ai'?1:0,body.vote==='uncertain'?1:0),createdAt:1,updatedAt:1,contentSource:'extension_submission',conflict:false},myVote:body.vote??null,sequence:body.sequence??0,published:!!body.vote};
    return Response.json(state);
  });
  vi.stubGlobal('fetch',fetcher);await boot();
});
describe('background lifecycle and secrets',()=>{
  it('requires informed enablement and never returns secrets to content scripts',async()=>{
    expect((await send({type:'analyze',snapshot},content)).error).toBe('disabled');
    expect((await send({type:'settings'},content)).ok).toBe(false);
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    expect(local.values.key).toBeUndefined();expect(session.values.key).toBe('personal-fixture');
    expect(JSON.stringify(await send({type:'settings'}))).not.toContain('personal-fixture');
    expect(local.setAccessLevel).toHaveBeenCalledWith({accessLevel:'TRUSTED_CONTEXTS'});
    expect(session.setAccessLevel).toHaveBeenCalledWith({accessLevel:'TRUSTED_CONTEXTS'});
  });
  it('prioritizes personal Jev, does not fetch X, and never transmits its key to the website',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    const response=await send({type:'analyze',snapshot},content);
    await send({type:'community',snapshot},content);
    expect(response.data.analysis).toMatchObject({human:.8,source:'client_byok'});
    for(const [url,options]of fetcher.mock.calls){if(!String(url).startsWith('https://api.typesafe.ai/'))expect(JSON.stringify(options)).not.toContain('personal-fixture');}
    expect(fetcher.mock.calls.every(([url])=>String(url).startsWith('https://api.typesafe.ai/')||String(url).startsWith('https://x.aileetcode.com/'))).toBe(true);
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/community')).map(([,opts])=>JSON.parse(String(opts?.body)))).toEqual([snapshot]);
    expect(JSON.stringify(response)).not.toContain('personal-fixture');
  });
  it('never falls back to website detection after a personal Jev failure',async()=>{
    fetcher.mockResolvedValue(new Response('',{status:401}));
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'invalid-fixture'});
    const response=await send({type:'analyze',snapshot},content);
    expect(response.data.analysis).toBeUndefined();expect(response.data.error).toBe('key_invalid');
    expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual(['https://api.typesafe.ai/v1/systemone']);
  });
  it('sends only page snapshots and votes to the website, never personal model results',async()=>{
    online=true;
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    await send({type:'analyze',snapshot},content);
    await send({type:'community',snapshot},content);
    await send({type:'vote',snapshot,vote:'human'},content);
    const calls=fetcher.mock.calls.filter(([url])=>String(url).startsWith('https://x.aileetcode.com/'));
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual(snapshot);
    expect(Object.keys(JSON.parse(String(calls[1][1]?.body))).sort()).toEqual(['sequence','snapshot','vote']);
    for(const [,options] of calls) for(const field of ['analysis','confidence','probabilities','model','personal-fixture']) expect(String(options?.body)).not.toContain(field);
  });
  it('discards old shared model caches without reusing or uploading them',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    const rid=await reviewId(snapshot),state=local.values.state as any;
    const legacy={human:.9,ai:.1,confidence:.8,source:'server_jev',model:'jev-1.13.0',ruleVersion:'authorship-v1',evaluatedAt:Date.now()};
    state.cache[rid]={at:Date.now(),analysis:legacy,state:{review:{id:rid,snapshot,analysis:legacy,tally:tally(1,0),createdAt:1,updatedAt:1,contentSource:'extension_submission',conflict:false},myVote:'human',sequence:1,published:true}};
    const result=await send({type:'analyze',snapshot},content);
    expect(result.data.error).toBe('personal_key_required');expect(result.data.analysis).toBeUndefined();
    expect(result.data.state.review).not.toHaveProperty('analysis');
    expect(JSON.stringify((local.values.state as any).cache)).not.toContain('server_jev');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists only latest offline intent and synchronizes after worker restart',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    await send({type:'vote',snapshot,vote:'human'},content);await send({type:'vote',snapshot,vote:'ai'},content);
    const before=await send({type:'settings'});expect(before.data.queue).toHaveLength(1);expect(before.data.queue[0].vote).toBe('ai');
    const priorToken=(local.values.state as any).token;
    await boot();online=true;
    const result=await send({type:'sync'});expect(result.data.queue).toEqual([]);
    expect((local.values.state as any).token).toBe(priorToken);
  });
  it('persists an uncertain vote offline and uploads it after restart without turning it into a withdrawal',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    await send({type:'vote',snapshot,vote:'human'},content);await send({type:'vote',snapshot,vote:'uncertain'},content);
    expect((await send({type:'settings'})).data.queue[0].vote).toBe('uncertain');
    await boot();online=true;await send({type:'sync'});
    const current=(local.values.state as any).cache[await reviewId(snapshot)];
    expect(current.state.myVote).toBe('uncertain');expect(current.state.review.tally).toMatchObject({human:0,ai:0,uncertain:1,total:1});
    const sent=fetcher.mock.calls.filter(([url])=>String(url).includes('/votes/')).at(-1)!;
    expect(sent[1]?.method).toBe('PUT');expect(JSON.parse(String(sent[1]?.body)).vote).toBe('uncertain');
    await send({type:'vote',snapshot,vote:null},content);
    expect((local.values.state as any).cache[await reviewId(snapshot)].state.review.tally.total).toBe(0);
  });
  it('persists a vote while an unrelated slow model request is still in flight',async()=>{
    let release!:()=>void, started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{started=resolve;});
    const defaultFetch=fetcher.getMockImplementation() as (input:string|Request|URL,options?:RequestInit)=>Promise<Response>;
    fetcher.mockImplementation(async(input,options)=>{if(String(input).startsWith('https://api.typesafe.ai/')){started();await gate;}return defaultFetch(input,options);});
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    const analyzing=send({type:'analyze',snapshot},content);await ready;
    try { await send({type:'vote',snapshot,vote:'human'},content);expect((await send({type:'settings'})).data.queue[0].vote).toBe('human'); }
    finally { release(); }
    await analyzing;
    expect((await send({type:'settings'})).data.queue[0].vote).toBe('human');
  });
  it('keeps withdrawal intent across failures',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    await send({type:'vote',snapshot,vote:'human'},content);await send({type:'vote',snapshot,vote:null},content);
    expect((await send({type:'settings'})).data.queue[0].vote).toBeNull();
    online=true;await send({type:'sync'});
    expect(fetcher.mock.calls.some(([url,opts])=>String(url).includes('/votes/')&&opts?.method==='DELETE')).toBe(true);
  });
  it('keeps empty failure states honest without a personal key',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    const response=await send({type:'analyze',snapshot},content);
    expect(response.data.analysis).toBeUndefined();expect(response.data.error).toBe('personal_key_required');expect(fetcher).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url])=>String(url).startsWith('https://api.typesafe.ai'))).toBe(false);
  });
  it('attempts an invalid personal key only once and preserves community results',async()=>{
    online=true;
    const defaultFetch=fetcher.getMockImplementation() as (input:string|Request|URL,options?:RequestInit)=>Promise<Response>;
    fetcher.mockImplementation(async(input,options)=>String(input).startsWith('https://api.typesafe.ai/')?new Response('',{status:401}):defaultFetch(input,options));
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'invalid-fixture'});
    const response=await send({type:'analyze',snapshot},content);
    expect(response.data.error).toBe('key_invalid');expect((await send({type:'community',snapshot},content)).data.state.review).toBeDefined();
    expect(fetcher.mock.calls.filter(([url])=>String(url).startsWith('https://api.typesafe.ai/'))).toHaveLength(1);
  });
  it('switches key persistence only on explicit choice and clears both stores',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:true,key:'personal-fixture'});
    expect(local.values.key).toBe('personal-fixture');expect(session.values.key).toBeUndefined();
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    expect(local.values.key).toBeUndefined();expect(session.values.key).toBe('personal-fixture');
    await send({type:'clear_key'});expect(local.values.key).toBeUndefined();expect(session.values.key).toBeUndefined();
  });
  it('returns personal and cached results before a slow community request completes',async()=>{
    let release!:()=>void, started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{started=resolve;});
    const original=fetcher.getMockImplementation() as typeof fetch;
    fetcher.mockImplementation(async(input,options)=>{
      if(String(input).includes('/community')){started();await gate;}
      return original(input,options);
    });
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    const stats=send({type:'community',snapshot},content);await ready;
    try {
      expect((await send({type:'analyze',snapshot},content)).data.analysis.source).toBe('client_byok');
      expect((await send({type:'analyze',snapshot},content)).data.analysis.source).toBe('client_byok');
      expect(fetcher.mock.calls.filter(([url])=>String(url).startsWith('https://api.typesafe.ai/'))).toHaveLength(1);
    } finally { release(); }
    expect((await stats).data.communityError).toBe('unavailable');
    expect((local.values.state as any).cache[await reviewId(snapshot)].analysis.source).toBe('client_byok');
  },1500);
  it('coalesces concurrent requests for the same comment version',async()=>{
    let release!:()=>void, started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{started=resolve;});
    const original=fetcher.getMockImplementation() as typeof fetch;
    fetcher.mockImplementation(async(input,options)=>{
      if(String(input).startsWith('https://api.typesafe.ai/')){started();await gate;}
      return original(input,options);
    });
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    const a=send({type:'analyze',snapshot},content);await ready;
    const b=send({type:'analyze',snapshot},content);
    release();
    expect((await Promise.all([a,b])).every(r=>r.data.analysis.source==='client_byok')).toBe(true);
    expect(fetcher.mock.calls.filter(([url])=>String(url).startsWith('https://api.typesafe.ai/'))).toHaveLength(1);
  });
  it('does not block personal detection or overwrite newer intent during an offline vote',async()=>{
    let release!:()=>void, started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{started=resolve;});
    const original=fetcher.getMockImplementation() as typeof fetch;
    fetcher.mockImplementation(async(input,options)=>{
      if(String(input).includes('/votes/')){started();await gate;}
      return original(input,options);
    });
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    const a=send({type:'vote',snapshot,vote:'human'},content);await ready;
    const b=send({type:'vote',snapshot,vote:'ai'},content);
    try {
      await vi.waitFor(async()=>expect((await send({type:'settings'})).data.queue[0].vote).toBe('ai'),{timeout:500,interval:5});
      expect((await send({type:'analyze',snapshot},content)).data.analysis.source).toBe('client_byok');
      expect((await send({type:'settings'})).data.queue[0].vote).toBe('ai');
    } finally { release(); }
    await Promise.all([a,b]);
    expect((await send({type:'settings'})).data.queue[0].vote).toBe('ai');
    online=true;await send({type:'sync'});
    expect((await send({type:'settings'})).data.queue).toEqual([]);
  },1500);
  it('does not let late statistics undo a vote or erase its model result',async()=>{
    online=true;
    let release!:()=>void, started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{started=resolve;});
    const original=fetcher.getMockImplementation() as typeof fetch;
    fetcher.mockImplementation(async(input,options)=>{
      const response=await original(input,options);
      if(String(input).includes('/community')){started();await gate;}
      return response;
    });
    await send({type:'save',enabled:true,consent:true,rememberKey:false,key:'personal-fixture'});
    const stats=send({type:'community',snapshot},content);await ready;
    try {
      await send({type:'analyze',snapshot},content);
      await send({type:'vote',snapshot,vote:'human'},content);
    } finally { release(); }
    const result=await stats;
    expect(result.data.state.myVote).toBe('human');expect(result.data.pending).toBeNull();
    const cached=(local.values.state as any).cache[await reviewId(snapshot)];
    expect(cached.analysis.source).toBe('client_byok');expect(cached.state.review.tally.total).toBe(1);
  });
});

describe('untrusted community responses',()=>{
  it('rejects invalid counters and sequences without poisoning the local vote queue',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    fetcher.mockResolvedValue(Response.json({review:{id:await reviewId(snapshot),snapshot,tally:{human:-1,ai:0,uncertain:0},createdAt:1,updatedAt:1,contentSource:'extension_submission',conflict:false},myVote:null,sequence:1e100,published:true}));
    const result=await send({type:'community',snapshot},content);
    expect(result.data.communityError).toBe('unavailable');expect(result.data.state).toBeUndefined();
    expect(Number.isSafeInteger((local.values.state as any).sequence)).toBe(true);
  });
  it('rejects a valid-looking response for another comment version',async()=>{
    await send({type:'save',enabled:true,consent:true,rememberKey:false});
    const other={...snapshot,comment:{...snapshot.comment,text:'Different synthetic comment'}};
    fetcher.mockResolvedValue(Response.json({review:{id:await reviewId(other),snapshot:other,tally:tally(1,0),createdAt:1,updatedAt:1,contentSource:'extension_submission',conflict:false},myVote:'human',sequence:1,published:true}));
    const result=await send({type:'community',snapshot},content);
    expect(result.data.communityError).toBe('unavailable');expect(result.data.state).toBeUndefined();
  });
});
