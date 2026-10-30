const base=require('../../../utils/score-entry-base');
const {createPokerInput}=require('../../../utils/poker-state');
Page({...base,data:{...base.data,rate:'1.00',antePoints:'1',maxBetPoints:'10',compareThreshold:'3',baoziBonusPoints:'10',shunjinBonusPoints:'5'},
buildCreateInput(){return createPokerInput(this.data);}});
