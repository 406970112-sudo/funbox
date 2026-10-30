const base=require('../../../utils/score-entry-base');
const {createPokerInput}=require('../../../utils/poker-state');
Page({...base,data:{...base.data,maxPlayers:'8',rate:'0.50',antePoints:'1',maxBetPoints:'20',compareThreshold:'3',baoziBonusPoints:'20',shunjinBonusPoints:'10'},
buildCreateInput(){return createPokerInput(this.data);}});
