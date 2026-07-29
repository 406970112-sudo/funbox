import { z } from 'zod'
import * as receivers from '../receivers_prod.json'
import * as receiverInfo from '../email_address.json'

function normalizeReceiverName(queryName, allReceivers) {
  // 首先检查是否完全匹配
  if (allReceivers.includes(queryName)) {
    return queryName;
  }
  
  // 检查是否是缩写或别名
  for (const receiver of allReceivers) {
    if (receiver.includes(queryName) || queryName.includes(receiver)) {
      console.log(1111, receiver)
      return receiver;
    }
  }
  
  // 如果没有找到匹配项，返回原始名称
  return queryName;
}

export const getReceiverTool = {
  description: 'Calculate who should receive notifications based on functions and mappings',
  name: 'getReceiver',
  parameters: z.object({
    function_list: z.array(
      z.object({
        name: z.string(),
        desc: z.string()
      })
    ).describe('List of functions with names and descriptions'),
    function_mapping: z.array(
      z.object({
        index: z.number(),
        receivers: z.optional(z.array(z.string())),
        exclude_receivers: z.optional(z.array(z.string()))
      })
    ).describe('Mapping of functions to receivers'),
    update_time: z.string().describe('The update time')
  }),
  execute: async ({ function_list, function_mapping, update_time }) => {
    const allReceivers = receivers;
    const receiverFunctionMap = new Map();

    allReceivers.forEach(receiver => {
      receiverFunctionMap.set(receiver, []);
    });

    function_mapping.forEach(mapping => {
      const { index, receivers: included, exclude_receivers: excluded } = mapping;
      let targetReceivers = [];

      if (included) {
        if (included.includes('ALL')) {
          targetReceivers = allReceivers;
        } else {
          // 在校验前先标准化接收者名称
          targetReceivers = included.map(name => normalizeReceiverName(name, allReceivers));
        }
      } else if (excluded) {
        // 在校验前先标准化排除接收者名称
        const excludedSet = new Set(excluded.map(name => normalizeReceiverName(name, allReceivers)));
        targetReceivers = allReceivers.filter(r => !excludedSet.has(r));
      }

      targetReceivers.forEach(receiver => {
        if (receiverFunctionMap.has(receiver)) {
          receiverFunctionMap.get(receiver).push(index);
        }
      });
    });

    const relation = [];
    receiverFunctionMap.forEach((function_index, name) => {
      if (function_index.length > 0) {
        const info = receiverInfo.find(el =>  el.bank === name || el.name === name)
        info && relation.push({ name, function_index, address: [...info.address, ...info.cc_address] });
      }
    });

    return {
      type: 'email-render',
      function_list,
      relation,
      update_time
    };
  }
}