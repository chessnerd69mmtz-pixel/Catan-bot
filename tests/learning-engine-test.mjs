import assert from "node:assert/strict";
import { makeGeometry, makeBoard } from "./logic-core.mjs";
import {
  defaultLearningStore,
  learningStateFingerprint,
  learningFeatures,
  parseFeedbackSuggestion,
  reviewFeedback,
  trainLearningModel,
  summarizeLearning
} from "../src/learning-engine.mjs";

const geo=makeGeometry();
const board=makeBoard(geo,{highPipsTouch:false});
const state={
  players:[
    {id:0,name:"You",vp:0,settlements:[],cities:[],roads:[],hand:{wood:3,brick:3,sheep:2,wheat:2,ore:1},development:{Knight:0,"Road Building":0,"Year of Plenty":0,Monopoly:0,"Victory Point":0}},
    {id:1,name:"Maya",vp:0,settlements:[10],cities:[],roads:[20],hand:{wood:2,brick:2,sheep:2,wheat:2,ore:2},development:{Knight:0,"Road Building":0,"Year of Plenty":0,Monopoly:0,"Victory Point":0}}
  ],
  board,
  geo,
  ports:[],
  bank:{wood:10,brick:10,sheep:10,wheat:10,ore:10},
  deckCount:25,
  targetVP:10,
  heldAwards:{roadOwner:null,armyOwner:null}
};

const parsed=parseFeedbackSuggestion("settlement at 17",state,0);
assert(parsed.ok,"Concrete settlement feedback should parse");
assert.equal(parsed.action.type,"settlement");
assert.equal(parsed.action.spot,17);

const fp=learningStateFingerprint(state,0);
assert.equal(typeof fp,"string");
assert(fp.length>0);

const features=learningFeatures(state,0,parsed.action);
assert.equal(features.length,20);
assert(features.every(Number.isFinite),"Learning features must remain finite");

const review=reviewFeedback("settlement at 17",{state,playerId:0,samples:32,horizon:4,seed:1234});
assert.equal(typeof review.accepted,"boolean");
if(review.accepted){
  assert(review.benchmark.confidenceLower>0,"Accepted learning must have a positive lower confidence bound");
  assert(review.benchmark.meanImprovement>=.01,"Accepted learning must clear the minimum improvement gate");
}

let store=defaultLearningStore();
store.lessons=[{
  featureDelta:Array(20).fill(0).map((_,i)=>i===1?1:i===9?-1:0),
  meanImprovement:.03
}];
const trained=trainLearningModel(store);
assert(trained.model.steps>0);
assert.equal(summarizeLearning(trained).lessons,1);
console.log("SAFE BOT LEARNING TESTS PASSED");
