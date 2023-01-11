"use strict";

function stableVal(input){
	if(!input || isNaN(input)) return 0;
	return input;
}

function randomVal(min,max){
	if(!min || !max || isNaN(min) || isNaN (max)) return 0;
	 return Math.floor(Math.random() * (max - min + 1) + min);
}

function increasingVal(start,increment){
	if(!start) start=0;
	if(!increment) increment=1;         
	return (start+increment);
}

exports.increasingVal=increasingVal;
exports.stableVal = stableVal;
exports.randomVal = randomVal;
