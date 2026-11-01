// Static content for the animal feeding game. Each animal accepts exactly one food, and no two animals share a food,
// so a drop is never ambiguous.

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
    // magic
    cupcake: { id: 'cupcake', emoji: '🧁', name: 'cupcake' },
};

/** Biomes in the order they unlock as the player levels up. */
export const BIOMES = ['farm', 'woodland', 'savanna', 'ocean', 'dinosaur'];

/** Not part of any biome's pool: appears now and then as a surprise (see `rareAnimalFor` in logic.js). */
export const UNICORN = { id: 'unicorn', emoji: '🦄', name: 'unicorn', biome: 'magic', rare: true, foods: ['cupcake'] };

export const ANIMALS = [
    { id: 'cow', emoji: '🐮', name: 'cow', biome: 'farm', foods: ['grass'] },
    { id: 'pig', emoji: '🐷', name: 'pig', biome: 'farm', foods: ['apple'] },
    { id: 'dog', emoji: '🐶', name: 'dog', biome: 'farm', foods: ['bone'] },
    { id: 'chicken', emoji: '🐔', name: 'chicken', biome: 'farm', foods: ['corn'] },
    { id: 'cat', emoji: '🐱', name: 'cat', biome: 'farm', foods: ['milk'] },
    { id: 'horse', emoji: '🐴', name: 'horse', biome: 'farm', foods: ['hay'] },

    { id: 'rabbit', emoji: '🐰', name: 'rabbit', biome: 'woodland', foods: ['carrot'] },
    { id: 'squirrel', emoji: '🐿️', name: 'squirrel', biome: 'woodland', foods: ['nut'] },
    { id: 'bear', emoji: '🐻', name: 'bear', biome: 'woodland', foods: ['honey'] },
    { id: 'hedgehog', emoji: '🦔', name: 'hedgehog', biome: 'woodland', foods: ['mushroom'] },
    { id: 'deer', emoji: '🦌', name: 'deer', biome: 'woodland', foods: ['leaf'] },
    { id: 'bird', emoji: '🐦', name: 'bird', biome: 'woodland', foods: ['berry'] },

    { id: 'monkey', emoji: '🐵', name: 'monkey', biome: 'savanna', foods: ['banana'] },
    { id: 'elephant', emoji: '🐘', name: 'elephant', biome: 'savanna', foods: ['melon'] },
    { id: 'giraffe', emoji: '🦒', name: 'giraffe', biome: 'savanna', foods: ['tree'] },
    { id: 'lion', emoji: '🦁', name: 'lion', biome: 'savanna', foods: ['meat'] },
    { id: 'hippo', emoji: '🦛', name: 'hippo', biome: 'savanna', foods: ['lettuce'] },
    { id: 'zebra', emoji: '🦓', name: 'zebra', biome: 'savanna', foods: ['mango'] },

    { id: 'dolphin', emoji: '🐬', name: 'dolphin', biome: 'ocean', foods: ['fish'] },
    { id: 'whale', emoji: '🐳', name: 'whale', biome: 'ocean', foods: ['shrimp'] },
    { id: 'octopus', emoji: '🐙', name: 'octopus', biome: 'ocean', foods: ['crab'] },
    { id: 'seal', emoji: '🦭', name: 'seal', biome: 'ocean', foods: ['tropicalfish'] },
    { id: 'turtle', emoji: '🐢', name: 'turtle', biome: 'ocean', foods: ['seaweed'] },
    { id: 'penguin', emoji: '🐧', name: 'penguin', biome: 'ocean', foods: ['squid'] },

    { id: 'trex', emoji: '🦖', name: 'T-rex', biome: 'dinosaur', foods: ['steak'] },
    { id: 'brontosaurus', emoji: '🦕', name: 'brontosaurus', biome: 'dinosaur', foods: ['palm'] },
    { id: 'crocodile', emoji: '🐊', name: 'crocodile', biome: 'dinosaur', foods: ['drumstick'] },
    { id: 'lizard', emoji: '🦎', name: 'lizard', biome: 'dinosaur', foods: ['cricket'] },
    { id: 'dragon', emoji: '🐉', name: 'dragon', biome: 'dinosaur', foods: ['chilli'] },
    { id: 'snake', emoji: '🐍', name: 'snake', biome: 'dinosaur', foods: ['egg'] },

    UNICORN,
];

export const animalById = id => ANIMALS.find(a => a.id === id);
