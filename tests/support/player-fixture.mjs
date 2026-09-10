export const generatedPlayer = () => ({entries:[
 {id:'p_stamina',kind:'resource',name:'体力',value:80,min:0,max:100,learnAt:null,learned:null,enabled:true,effect:'行动所需的体力',condition:'按本次实际行动消耗和恢复',rules:[{id:'p_run',condition:'完成剧烈行动',delta:-10,timing:'action'},{id:'p_rest',condition:'完成充分休息',delta:20,timing:'action'}],thresholds:[]},
 {id:'p_fire',kind:'skill',name:'火球术',value:35,min:0,max:100,learnAt:100,learned:true,enabled:true,effect:'向可见目标释放一枚火球',condition:'能够看见目标且可以施法',rules:[{id:'p_practice',condition:'完成一次有效的火球术练习',delta:2,timing:'action'},{id:'p_success',condition:'在本次实战中尝试使用火球术',delta:3,timing:'success'},{id:'p_failure',condition:'在本次实战中尝试使用火球术',delta:1,timing:'failure'}],thresholds:[]},
]});
