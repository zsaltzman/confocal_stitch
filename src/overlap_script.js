const cvreduce = require('./cv_overlap_reduce.js');
let folderPath = '/mnt/c/Users/Zach/Desktop/converted_img/';

cvreduce.calc_distance(folderPath + 'converted_img_01_01.tif', folderPath + 'converted_img_01_02.tif');