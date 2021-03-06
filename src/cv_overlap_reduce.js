const fs = require('fs').promises;

const cv = require('opencv4nodejs');

const lzw = require('node-lzw');
const lzwcompress = require('lzwcompress');

const BLACK = new cv.Vec(0, 0, 0);
const WHITE = new cv.Vec(255, 255, 255);

let folderPath = '/mnt/c/Users/Zach/Desktop/converted_img/';
let testPath = '/mnt/c/Users/Zach/Desktop/test_img/';

let run = async (imgname1 = folderPath + 'converted_img_01_01.tif', imgname2 = folderPath + 'converted_img_01_02.tif') => {
	console.log('imgname 1', imgname1, 'imgname 2',  imgname2);
	try {
		const img1 = cv.imread(imgname1, cv.IMREAD_UNCHANGED);
		const img2 = cv.imread(imgname2, cv.IMREAD_UNCHANGED);


		let img1crop = img1.getRegion(new cv.Rect(img1.cols * (2/3), 0, img1.cols * (1/3), img1.rows));
		let img2crop = img2.getRegion(new cv.Rect(0, 0, img2.cols * (1/3), img2.rows));

		//detector expects 8 bit images
		img1crop = img1crop.convertTo(cv.CV_8UC4, 1/256.0), img2crop = img2crop.convertTo(cv.CV_8UC4, 1/256.0);
		img1crop = img1crop.mul(10), img2crop = img2crop.mul(10);
		cv.imwrite(testPath + 'cropped_im1.tif', img1crop);
		cv.imwrite(testPath + 'cropped_im2.tif', img2crop)

		// run detector and plot matches
		let detector = new cv.SURFDetector();
		let keypoints1 = await detector.detectAsync(img1crop), keypoints2 = await detector.detectAsync(img2crop);
		let labeledImg1 = drawkp(img1crop, keypoints1);
		let labeledImg2 = drawkp(img2crop, keypoints2);

		await cv.imwrite(testPath + 'labeled_img1.tif', labeledImg1);
		await cv.imwrite(testPath + 'labeled_img2.tif', labeledImg2);

		const descriptors1 = detector.compute(img1crop, keypoints1);
		const descriptors2 = detector.compute(img2crop, keypoints2);

		const bf = new cv.BFMatcher(cv.NORM_L2, true);

		// match the feature descriptors then sort them by which features seem to be directly across from each other
		let matches = bf.match(descriptors1, descriptors2);
		let matchedPoints = matches.map( (e) => {
			console.log('e', e);
			let queryPt = keypoints1[e.queryIdx], trainPt = keypoints2[e.trainIdx];
			return { 
				'query' : keypoints1[e.queryIdx], 
				'train' : keypoints2[e.trainIdx],
				'yDistance' : Math.abs(keypoints1[e.queryIdx].pt.y - keypoints2[e.trainIdx].pt.y)  
			};
		});

		console.log('matched points', matchedPoints);

		//console.log('matches', matches);
		let matchedImg = cv.drawMatches(img1crop, img2crop, keypoints1, keypoints2, matches);
		await cv.imwrite(testPath + 'matched_img.tif', matchedImg);

		// now determine the distance to crop from each image using the match
		let distance = [];
		for (let match of matches) {
			let queryPt = keypoints1[match.queryIdx].pt;
			distance.push(img1crop.cols - queryPt.x);
		}

		distance = distance.sort( (a, b) => {
			return a - b;
		});

		return { 'distance' : Math.floor(distance[Math.floor(distance.length / 2)]), 'baseWidth' : img1.cols, 'baseHeight' : img1.rows }; // median distance

	} catch(e) {
		console.log('An error occured', e);
	}
}

async function decompressedSave(path, mat) {
	await cv.imwrite(path, mat);
	let file = await fs.readFile(path);
	await fs.writeFile(path, decoded);
}

function printMat(mat) {
	for (let i = 0; i < mat.rows; i++) {
		let matRow = '';
		for (let j = 0; j < mat.cols; j++) {
			matRow = matRow + mat.at(i, j) + ' ';
		}
		console.log(matRow);
	}
}
function drawkp(img, keypoints) {
	let clonedImg = img.copy();
	for (let kp of keypoints) {
	clonedImg.drawRectangle(
		new cv.Point(kp.pt.x - 5, kp.pt.y - 5),
		new cv.Point(kp.pt.x + 5, kp.pt.y + 5),
		{ color: BLACK, thickness: 1});
	}

	return clonedImg;
}

module.exports = {
	'calc_distance' : run
};


//let kernel = new cv.Mat([ [0, -1, 0], [-1, 5, -1], [0, -1, 0]], cv.CV_8S);

// let sharpenedImg1 = grayImg1.filter2D(-1, kernel); sharpenedImg1 = sharpenedImg1.convertTo(cv.CV_8UC3);
// let sharpenedImg2 = grayImg2.filter2D(-1, kernel); sharpenedImg2 = sharpenedImg2.convertTo(cv.CV_8UC3);