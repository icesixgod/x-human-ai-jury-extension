import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '../shared/contracts';
import './options.css';
declare const __VERSION__: string;
declare const __COMMIT__: string;
declare const __API_ORIGIN__: string;
declare const __SOURCE_URL__: string;
type Settings = { enabled: boolean; consent: boolean; rememberKey: boolean; hasKey: boolean; api: string; queue: { id:string; commentId:string; vote:string|null; error?:string; blocked?:boolean }[] };
async function message(input: unknown) {
  const response = await chrome.runtime.sendMessage(input);
  if (!response?.ok) throw new Error(messages[response?.error] || '操作失败，请重试');
  return response.data as Settings;
}
function App() {
  const [settings,setSettings] = useState<Settings>();
  const [consent,setConsent] = useState(false), [enabled,setEnabled] = useState(false), [remember,setRemember] = useState(false), [key,setKey] = useState('');
  const [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  function apply(s:Settings) { setSettings(s); setConsent(s.consent);setEnabled(s.enabled);setRemember(s.rememberKey); }
  useEffect(()=>{void message({type:'settings'}).then(apply).catch(e=>setNotice(e.message));},[]);
  async function save() {
    setBusy(true);setNotice('');
    try {
      if (key.trim() && !await chrome.permissions.request({origins:['https://api.typesafe.ai/*']})) throw new Error('未授予 TypeSafe 访问权限，个人 Key 未保存。');
      apply(await message({type:'save',enabled,consent,rememberKey:remember,...(key.trim()?{key:key.trim()}:{})}));setKey('');setNotice('设置已保存。已打开的 X 页面会自动更新。');
    } catch(e) { setNotice((e as Error).message); } finally { setBusy(false); }
  }
  return <main><header><span className="logo">✓ × ?</span><div><h1>X 人机评审团</h1><p>扩展设置 · {__VERSION__}</p></div><a href={__API_ORIGIN__} target="_blank" rel="noreferrer">公开评审 ↗</a></header>
    <section><span className="eyebrow">01 / 开始使用</span><h2>让每一次判断都有来处。</h2><p>在 X 帖子详情页，自动对照 Jev 的判断与评审团的选择。</p><div className="disclosure"><strong>启用前，请了解数据如何流动</strong><ul><li>原帖和评论直接从当前 X 页面读取；配置个人 Key 后直接发送到 TypeSafe；判断结果只保存在本机。</li><li>不调用 X 接口或爬取其他页面。跳过页面上识别到的受保护或不完整内容；页面快照未经独立核实。</li><li>你的首张人工票提交后，对应文本快照和评审团汇总票数会公开。投票凭证不会公开。</li><li>获取社区统计和提交投票时，快照会发送至 {__API_ORIGIN__}；个人 Key 和 Jev 判断结果均不发送给网站。断网投票保存在本机，恢复后同步。</li><li>匿名安装身份不等于真实人数；检测结果不能证明作者身份。</li></ul><a href={`${__API_ORIGIN__}/privacy.html`} target="_blank" rel="noreferrer">完整隐私说明 ↗</a></div>
      <label className="check"><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);if(!e.target.checked)setEnabled(false);}}/>我已了解以上数据用途和公开规则</label><label className="check"><input type="checkbox" checked={enabled} disabled={!consent} onChange={e=>setEnabled(e.target.checked)}/>自动判断进入视野的评论</label>
    </section><section><span className="eyebrow">02 / 本机 Jev 判断</span><h2>使用自己的 Jev。</h2><p>Jev 只通过个人 Key 在插件中调用，结果仅在本机显示。没有 Key 或调用失败时，仍可查看评审团票数和参与投票。</p><label htmlFor="key">TypeSafe API Key <small>{settings?.hasKey ? '已配置 · 留空保持原值' : '选填'}</small></label><input id="key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} placeholder="只保存在此浏览器"/>
      <label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>在此浏览器记住 Key</label><p className="hint">默认关闭浏览器后清除。勾选后使用扩展本地存储，不提供静态加密；Key 不与其他设备同步。</p>{settings?.hasKey && <button className="text-button" onClick={()=>void message({type:'clear_key'}).then(s=>{apply(s);setNotice('个人 Key 已清除。');})}>清除已保存的 Key</button>}
    </section><div className="save-row"><button className="primary" disabled={busy||!settings} onClick={()=>void save()}>{busy?'正在保存…':'保存设置'}</button><p role="status">{notice}</p></div>
    <section><span className="eyebrow">03 / 同步状态</span><h2>{settings?.queue.length ?? 0} 条投票待同步</h2><p>重复同步不会多计票。暂停自动判断后也会暂停后台同步，已保存的投票保留在本机。</p>{settings?.queue.map(p=><div className="queue-item" key={p.id}><span>评论 #{p.commentId.slice(-8)} · {p.vote==='human'?'真人':p.vote==='ai'?'AI':p.vote==='uncertain'?'不确定':'撤回'}</span><span>{p.error?messages[p.error]||'等待同步':'等待同步'}</span></div>)}<button disabled={busy||!settings?.enabled||!settings.queue.length} onClick={async()=>{setBusy(true);try{apply(await message({type:'sync'}));setNotice('同步尝试已完成。');}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}}>立即重试同步</button></section>
    <footer>AGPL-3.0-only · {__SOURCE_URL__ ? <a href={__SOURCE_URL__} target="_blank" rel="noreferrer">提交 {__COMMIT__.slice(0,12)}</a> : <span>{__COMMIT__.endsWith('-dirty')?'开发构建 · ':''}{__COMMIT__.slice(0,12)}</span>} · <a href={chrome.runtime.getURL('source.tar.gz')}>此版本源码</a> · <a href={chrome.runtime.getURL('LICENSE.txt')}>许可证</a></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
