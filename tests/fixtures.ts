import type { Snapshot } from '../shared/contracts';
export const snapshot: Snapshot = {
  original:{id:'10001',url:'https://x.com/i/status/10001',text:'What did you build this weekend?'},
  comment:{id:'10002',url:'https://x.com/i/status/10002',text:'A tiny timer for the plants on my desk.'},publicConfirmed:true,complete:true,
};
export const answer = {model:'jev-1.13.0',answers:{authorship:{type:'choice',choice:'human',probabilities:{human:.8,ai:.2},confidence:.7}}};
