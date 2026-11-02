// Static content for the animal feeding game. Each animal has a palette of foods it will happily eat (`foods`, the
// first being its favourite), so feeding an apple to a horse is fine. A pig has `eatsAnything: true`: every food is OK.
// Favourites are unique per animal so an animal can always be identified by what it asks for.

export const FOODS = {
    // farm
    grass: { id: 'grass', emoji: '🌿', name: 'grass' },
    apple: { id: 'apple', emoji: '🍎', name: 'apple' },
    bone: { id: 'bone', emoji: '🦴', name: 'bone' },
    corn: { id: 'corn', emoji: '🌽', name: 'corn' },
    milk: { id: 'milk', emoji: '🥛', name: 'milk' },
    hay: { id: 'hay', emoji: '🌾', name: 'hay' },
    // woodland
    carrot: { id: 'carrot', emoji: '🥕', name: 'carrot' },
    nut: { id: 'nut', emoji: '🥜', name: 'nut' },
    honey: { id: 'honey', emoji: '🍯', name: 'honey' },
    mushroom: { id: 'mushroom', emoji: '🍄', name: 'mushroom' },
    leaf: { id: 'leaf', emoji: '🍃', name: 'leaf' },
    berry: { id: 'berry', emoji: '🍓', name: 'berry' },
    // african savannah
    banana: { id: 'banana', emoji: '🍌', name: 'banana' },
    melon: { id: 'melon', emoji: '🍉', name: 'melon' },
    tree: { id: 'tree', emoji: '🌳', name: 'tree leaves' },
    meat: { id: 'meat', emoji: '🍖', name: 'meat' },
    lettuce: { id: 'lettuce', emoji: '🥬', name: 'lettuce' },
    mango: { id: 'mango', emoji: '🥭', name: 'mango' },
    clover: { id: 'clover', emoji: '🍀', name: 'clover' },
    // ocean
    fish: { id: 'fish', emoji: '🐟', name: 'fish' },
    shrimp: { id: 'shrimp', emoji: '🦐', name: 'shrimp' },
    crab: { id: 'crab', emoji: '🦀', name: 'crab' },
    tropicalfish: { id: 'tropicalfish', emoji: '🐠', name: 'little fish' },
    seaweed: { id: 'seaweed', emoji: '🌱', name: 'seaweed' },
    squid: { id: 'squid', emoji: '🦑', name: 'squid' },
    // dinosaurs
    steak: { id: 'steak', emoji: '🥩', name: 'steak' },
    palm: { id: 'palm', emoji: '🌴', name: 'palm leaves' },
    drumstick: { id: 'drumstick', emoji: '🍗', name: 'drumstick' },
    cricket: { id: 'cricket', emoji: '🦗', name: 'cricket' },
    chilli: { id: 'chilli', emoji: '🌶️', name: 'chilli' },
    egg: { id: 'egg', emoji: '🥚', name: 'egg' },
    // mythical worlds
    blossom: { id: 'blossom', emoji: '🌸', name: 'blossom' },
    chestnut: { id: 'chestnut', emoji: '🌰', name: 'chestnut' },
    potato: { id: 'potato', emoji: '🥔', name: 'potato' },
    potion: { id: 'potion', emoji: '🧪', name: 'magic potion' },
    grapes: { id: 'grapes', emoji: '🍇', name: 'grapes' },
    cherries: { id: 'cherries', emoji: '🍒', name: 'cherries' },
    fly: { id: 'fly', emoji: '🪰', name: 'fly' },
    greenapple: { id: 'greenapple', emoji: '🍏', name: 'green apple' },
    orange: { id: 'orange', emoji: '🍊', name: 'orange' },
    seeds: { id: 'seeds', emoji: '🌻', name: 'sunflower seeds' },
    cake: { id: 'cake', emoji: '🍰', name: 'cake' },
    bread: { id: 'bread', emoji: '🍞', name: 'bread' },
    kebab: { id: 'kebab', emoji: '🍢', name: 'kebab' },
    beetle: { id: 'beetle', emoji: '🪲', name: 'beetle' },
    tempura: { id: 'tempura', emoji: '🍤', name: 'fried shrimp' },
    sweetpotato: { id: 'sweetpotato', emoji: '🍠', name: 'sweet potato' },
    croissant: { id: 'croissant', emoji: '🥐', name: 'croissant' },
    peach: { id: 'peach', emoji: '🍑', name: 'peach' },
    tomato: { id: 'tomato', emoji: '🍅', name: 'tomato' },
    snail: { id: 'snail', emoji: '🐌', name: 'snail' },
    pizza: { id: 'pizza', emoji: '🍕', name: 'pizza' },
    battery: { id: 'battery', emoji: '🔋', name: 'battery' },
    donut: { id: 'donut', emoji: '🍩', name: 'donut' },
    icecream: { id: 'icecream', emoji: '🍦', name: 'ice cream' },
    coconut: { id: 'coconut', emoji: '🥥', name: 'coconut' },
    candy: { id: 'candy', emoji: '🍬', name: 'candy' },
    cookie: { id: 'cookie', emoji: '🍪', name: 'cookie' },
    daisy: { id: 'daisy', emoji: '🌼', name: 'daisy' },
    // magic
    cupcake: { id: 'cupcake', emoji: '🧁', name: 'cupcake' },
};

/**
 * Worlds in the order they unlock. A world is the background and the animals that live there; it starts at `fromLevel`
 * and lasts until the next one starts. Beyond level 100 the last world stays.
 */
export const WORLDS = [
    { id: 'farm', name: 'the farm', emoji: '🏡', fromLevel: 1, mythical: false },
    { id: 'woodland', name: 'the woods', emoji: '🌲', fromLevel: 6, mythical: false },
    { id: 'savanna', name: 'the savannah', emoji: '🌅', fromLevel: 11, mythical: false },
    { id: 'ocean', name: 'the ocean', emoji: '🌊', fromLevel: 16, mythical: false },
    { id: 'dinosaur', name: 'dinosaur land', emoji: '🌋', fromLevel: 21, mythical: false },
    { id: 'enchanted', name: 'the enchanted forest', emoji: '🧚', fromLevel: 31, mythical: true },
    { id: 'crystal', name: 'the crystal caves', emoji: '💎', fromLevel: 41, mythical: true },
    { id: 'cloud', name: 'the cloud kingdom', emoji: '☁️', fromLevel: 51, mythical: true },
    { id: 'volcano', name: 'dragon volcano', emoji: '🐲', fromLevel: 61, mythical: true },
    { id: 'castle', name: 'the fairy tale castle', emoji: '🏰', fromLevel: 71, mythical: true },
    { id: 'space', name: 'outer space', emoji: '🪐', fromLevel: 81, mythical: true },
    { id: 'rainbow', name: 'unicorn rainbow land', emoji: '🌈', fromLevel: 91, mythical: true },
];

/** World ids in unlock order. */
export const BIOMES = WORLDS.map(w => w.id);

/** Not part of any biome's pool: appears now and then as a surprise (see `rareAnimalFor` in logic.js). */
export const UNICORN = { id: 'unicorn', emoji: '🦄', name: 'unicorn', biome: 'magic', rare: true, foods: ['cupcake', 'apple', 'carrot'] };

export const ANIMALS = [
    { id: 'cow', emoji: '🐮', name: 'cow', biome: 'farm', foods: ['grass', 'hay', 'corn'] },
    { id: 'pig', emoji: '🐷', name: 'pig', biome: 'farm', foods: ['apple', 'corn', 'carrot'], eatsAnything: true },
    { id: 'dog', emoji: '🐶', name: 'dog', biome: 'farm', foods: ['bone', 'meat', 'steak'] },
    { id: 'chicken', emoji: '🐔', name: 'chicken', biome: 'farm', foods: ['corn', 'seeds', 'berry'] },
    { id: 'cat', emoji: '🐱', name: 'cat', biome: 'farm', foods: ['milk', 'fish', 'shrimp'] },
    { id: 'horse', emoji: '🐴', name: 'horse', biome: 'farm', foods: ['hay', 'apple', 'carrot', 'grass'] },

    { id: 'rabbit', emoji: '🐰', name: 'rabbit', biome: 'woodland', foods: ['carrot', 'lettuce', 'leaf'] },
    { id: 'squirrel', emoji: '🐿️', name: 'squirrel', biome: 'woodland', foods: ['nut', 'berry', 'mushroom'] },
    { id: 'bear', emoji: '🐻', name: 'bear', biome: 'woodland', foods: ['honey', 'berry', 'fish'] },
    { id: 'hedgehog', emoji: '🦔', name: 'hedgehog', biome: 'woodland', foods: ['mushroom', 'cricket'] },
    { id: 'deer', emoji: '🦌', name: 'deer', biome: 'woodland', foods: ['leaf', 'grass', 'apple'] },
    { id: 'bird', emoji: '🐦', name: 'bird', biome: 'woodland', foods: ['berry', 'cricket', 'corn'] },

    { id: 'monkey', emoji: '🐵', name: 'monkey', biome: 'savanna', foods: ['banana', 'mango', 'nut'] },
    { id: 'elephant', emoji: '🐘', name: 'elephant', biome: 'savanna', foods: ['melon', 'tree', 'banana', 'grass'] },
    { id: 'giraffe', emoji: '🦒', name: 'giraffe', biome: 'savanna', foods: ['tree', 'leaf', 'palm'] },
    { id: 'lion', emoji: '🦁', name: 'lion', biome: 'savanna', foods: ['meat', 'steak', 'drumstick'] },
    { id: 'hippo', emoji: '🦛', name: 'hippo', biome: 'savanna', foods: ['lettuce', 'grass', 'melon'] },
    { id: 'zebra', emoji: '🦓', name: 'zebra', biome: 'savanna', foods: ['clover', 'grass', 'hay'] },

    { id: 'dolphin', emoji: '🐬', name: 'dolphin', biome: 'ocean', foods: ['fish', 'tropicalfish', 'squid', 'shrimp'] },
    { id: 'whale', emoji: '🐳', name: 'whale', biome: 'ocean', foods: ['shrimp', 'squid'] },
    { id: 'octopus', emoji: '🐙', name: 'octopus', biome: 'ocean', foods: ['crab', 'shrimp'] },
    { id: 'seal', emoji: '🦭', name: 'seal', biome: 'ocean', foods: ['tropicalfish', 'fish', 'squid'] },
    { id: 'turtle', emoji: '🐢', name: 'turtle', biome: 'ocean', foods: ['seaweed', 'lettuce'] },
    { id: 'penguin', emoji: '🐧', name: 'penguin', biome: 'ocean', foods: ['squid', 'fish', 'shrimp'] },

    { id: 'trex', emoji: '🦖', name: 'T-rex', biome: 'dinosaur', foods: ['steak', 'meat', 'drumstick'] },
    { id: 'brontosaurus', emoji: '🦕', name: 'brontosaurus', biome: 'dinosaur', foods: ['palm', 'tree', 'leaf'] },
    { id: 'crocodile', emoji: '🐊', name: 'crocodile', biome: 'dinosaur', foods: ['drumstick', 'fish', 'meat'] },
    { id: 'lizard', emoji: '🦎', name: 'lizard', biome: 'dinosaur', foods: ['cricket', 'fly'] },
    { id: 'dragon', emoji: '🐉', name: 'dragon', biome: 'dinosaur', foods: ['chilli', 'meat'] },
    { id: 'snake', emoji: '🐍', name: 'snake', biome: 'dinosaur', foods: ['egg', 'cricket'] },

    { id: 'fairy', emoji: '🧚', name: 'fairy', biome: 'enchanted', foods: ['blossom', 'berry', 'honey'] },
    { id: 'elf', emoji: '🧝', name: 'elf', biome: 'enchanted', foods: ['chestnut', 'nut', 'mushroom'] },
    { id: 'troll', emoji: '🧌', name: 'troll', biome: 'enchanted', foods: ['potato', 'meat', 'mushroom'] },
    { id: 'wizard', emoji: '🧙', name: 'wizard', biome: 'enchanted', foods: ['potion', 'cupcake'] },

    { id: 'genie', emoji: '🧞', name: 'genie', biome: 'crystal', foods: ['grapes', 'mango', 'cupcake'] },
    { id: 'bat', emoji: '🦇', name: 'bat', biome: 'crystal', foods: ['cherries', 'banana'] },
    { id: 'spider', emoji: '🕷️', name: 'spider', biome: 'crystal', foods: ['fly', 'cricket'] },
    { id: 'glowworm', emoji: '🐛', name: 'glow worm', biome: 'crystal', foods: ['greenapple', 'leaf', 'apple'] },

    { id: 'phoenix', emoji: '🦅', name: 'phoenix', biome: 'cloud', foods: ['orange', 'chilli', 'mango'] },
    { id: 'dove', emoji: '🕊️', name: 'dove', biome: 'cloud', foods: ['seeds', 'corn', 'berry'] },
    { id: 'cherub', emoji: '👼', name: 'cherub', biome: 'cloud', foods: ['cake', 'cupcake', 'milk'] },
    { id: 'swan', emoji: '🦢', name: 'swan', biome: 'cloud', foods: ['bread', 'lettuce', 'seaweed'] },

    { id: 'firedragon', emoji: '🐲', name: 'fire dragon', biome: 'volcano', foods: ['kebab', 'chilli', 'steak'] },
    { id: 'scorpion', emoji: '🦂', name: 'scorpion', biome: 'volcano', foods: ['beetle', 'cricket'] },
    { id: 'lobster', emoji: '🦞', name: 'lava lobster', biome: 'volcano', foods: ['tempura', 'crab', 'shrimp'] },
    { id: 'boar', emoji: '🐗', name: 'boar', biome: 'volcano', foods: ['sweetpotato', 'mushroom', 'corn'] },

    { id: 'prince', emoji: '🤴', name: 'prince', biome: 'castle', foods: ['croissant', 'apple', 'milk'] },
    { id: 'princess', emoji: '👸', name: 'princess', biome: 'castle', foods: ['peach', 'berry', 'cupcake'] },
    { id: 'count', emoji: '🧛', name: 'count', biome: 'castle', foods: ['tomato', 'steak', 'egg'] },
    { id: 'frog', emoji: '🐸', name: 'frog prince', biome: 'castle', foods: ['snail', 'cricket', 'fly'] },

    { id: 'alien', emoji: '👽', name: 'alien', biome: 'space', foods: ['pizza', 'egg'] },
    { id: 'robot', emoji: '🤖', name: 'robot', biome: 'space', foods: ['battery', 'pizza'] },
    { id: 'invader', emoji: '👾', name: 'space invader', biome: 'space', foods: ['donut', 'cupcake'] },
    { id: 'astronaut', emoji: '🧑‍🚀', name: 'astronaut', biome: 'space', foods: ['icecream', 'pizza', 'apple'] },

    { id: 'mermaid', emoji: '🧜', name: 'mermaid', biome: 'rainbow', foods: ['coconut', 'seaweed', 'fish'] },
    { id: 'flamingo', emoji: '🦩', name: 'flamingo', biome: 'rainbow', foods: ['candy', 'shrimp', 'tropicalfish'] },
    { id: 'peacock', emoji: '🦚', name: 'peacock', biome: 'rainbow', foods: ['cookie', 'seeds', 'berry'] },
    { id: 'butterfly', emoji: '🦋', name: 'butterfly', biome: 'rainbow', foods: ['daisy', 'blossom', 'honey'] },

    UNICORN,
];

export const animalById = id => ANIMALS.find(a => a.id === id);

/** Would this animal eat this food? True for anything in its palette, and for everything if it eats anything. */
export const acceptsFood = (animal, foodId) => animal.eatsAnything === true || animal.foods.includes(foodId);
