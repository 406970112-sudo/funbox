import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'https://www.themealdb.com/api/json/v1/1/';
const PREFERRED_AREAS = [
  { filter: 'Chinese', name: 'Chinese', zh: '中式' },
  { filter: 'Italian', name: 'Italian', zh: '意式' },
  { filter: 'Mexican', name: 'Mexican', zh: '墨西哥' },
  { filter: 'Japanese', name: 'Japanese', zh: '日式' },
  { filter: 'Thai', name: 'Thai', zh: '泰式' },
  { filter: 'France', name: 'French', zh: '法式' },
  { filter: 'India', name: 'Indian', zh: '印式' },
  { filter: 'British', name: 'British', zh: '英式' },
];
const OTHER_AREA_LIMIT = 6;

const AREA_ZH = {
  Chinese: '中式',
  Italian: '意式',
  Mexican: '墨西哥',
  Japanese: '日式',
  Thai: '泰式',
  British: '英式',
  France: '法式',
  India: '印式',
};

const DISH_ZH = {
  'Air Fryer Egg Rolls': '空气炸锅炸春卷',
  'Beef and Broccoli Stir-Fry': '西兰花炒牛肉',
  'Beef Lo Mein': '牛肉捞面',
  'Chicken Congee': '鸡丝粥',
  'Chicken Fried Rice': '鸡肉炒饭',
  'Chinese Orange Chicken': '陈皮橙香鸡',
  'Chinese Tomato Egg Stir Fry': '番茄炒蛋',
  'Egg Drop Soup': '蛋花汤',
  'Egg Foo Young': '芙蓉蛋',
  'General Tsos Chicken': '左宗棠鸡',
  'Hot and Sour Soup': '酸辣汤',
  'Kung Pao Chicken': '宫保鸡丁',
  'Kung Po Prawns': '宫保虾球',
  'Ma Po Tofu': '麻婆豆腐',
  'Napa Cabbage with Dried Shrimp': '虾皮白菜',
  'Ramen Noodles with Boiled Egg': '溏心蛋拉面',
  'Sesame Cucumber Salad': '麻酱黄瓜',
  'Shrimp Chow Fun': '虾仁炒河粉',
  'Shrimp With Snow Peas': '虾仁炒荷兰豆',
  'Sichuan Eggplant': '川味茄子',
  'Sichuan Style Stir-Fried Chinese Long Beans': '川式干煸四季豆',
  'Silken Tofu with Sesame Soy Sauce': '麻酱嫩豆腐',
  'Singapore Noodles with Shrimp': '星洲炒米粉',
  'Sweet and Sour Chicken': '糖醋鸡',
  'Sweet and Sour Pork': '糖醋里脊',
  'Szechuan Beef': '川式牛肉',
  Wontons: '炸云吞',
};

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch failed ${response.status} ${url}`);
  }
  return response.json();
}

async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function normalizeMeal(meal, fetchedAt) {
  const ingredients = [];
  for (let i = 1; i <= 20; i += 1) {
    const name = String(meal[`strIngredient${i}`] || '').trim();
    if (!name) continue;
    const measure = String(meal[`strMeasure${i}`] || '').trim();
    ingredients.push({ name, measure });
  }
  const steps = String(meal.strInstructions || '')
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
  const tags = String(meal.strTags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const name = String(meal.strMeal || '').trim();
  return {
    id: String(meal.idMeal || '').trim(),
    name,
    nameZh: DISH_ZH[name] || '',
    area: String(meal.strArea || '').trim(),
    areaZh: AREA_ZH[String(meal.strArea || '').trim()] || String(meal.strArea || '').trim(),
    category: String(meal.strCategory || '').trim(),
    tags,
    image: {
      url: String(meal.strMealThumb || '').trim(),
      source: 'themealdb',
      credit: 'TheMealDB',
      checkedAt: fetchedAt,
    },
    ingredients,
    steps,
    recipeSource: String(meal.strSource || '').trim(),
    videoUrl: String(meal.strYoutube || '').trim(),
    license: 'themealdb-open',
    fetchedAt,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const areas = await fetchJSON(`${BASE_URL}list.php?a=list`);
  const allAreas = (areas.meals || []).map((entry) => String(entry.strArea || '').trim()).filter(Boolean);
  const areaCounts = [];
  for (const area of PREFERRED_AREAS) {
    const meals = await fetchJSON(`${BASE_URL}filter.php?a=${encodeURIComponent(area.filter)}`);
    areaCounts.push({ name: area.name, zh: area.zh, count: (meals.meals || []).length });
  }

  const chineseList = await fetchJSON(`${BASE_URL}filter.php?a=Chinese`);
  const chineseIds = (chineseList.meals || []).map((meal) => String(meal.idMeal));
  const otherLists = await Promise.all(
    PREFERRED_AREAS.filter((area) => area.filter !== 'Chinese').map(async (area) => {
      const meals = await fetchJSON(`${BASE_URL}filter.php?a=${encodeURIComponent(area.filter)}`);
      return (meals.meals || []).slice(0, OTHER_AREA_LIMIT).map((meal) => String(meal.idMeal));
    }),
  );
  const otherIds = otherLists.flat();
  const allIds = [...new Set([...chineseIds, ...otherIds])];

  const meals = await mapWithLimit(allIds, 8, async (id) => {
    const detail = await fetchJSON(`${BASE_URL}lookup.php?i=${id}`);
    return normalizeMeal(detail.meals?.[0], fetchedAt);
  });

  const valid = meals.filter((meal) => meal.id && meal.name && meal.image.url && meal.ingredients.length > 0 && meal.steps.length > 0);
  const seed = {
    source: BASE_URL,
    fetchedAt,
    areas: areaCounts,
    dishes: valid,
  };
  const outputPath = path.resolve('backend/internal/cookingguide/seed.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(seed, null, 2)}\n`);
  const chineseCount = valid.filter((dish) => dish.area === 'Chinese').length;
  console.log(`areas=${areaCounts.length} dishes=${valid.length} chinese=${chineseCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
