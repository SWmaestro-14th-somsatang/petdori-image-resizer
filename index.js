'use strict';

import Sharp from "sharp"
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"

const S3 = new S3Client({
    region: 'ap-northeast-2'
});

const getQuerystring = (queryString, key) => {
    return new URLSearchParams("?" + queryString).get(key);
}

export const imageResize = async (event, context) => {
    //event에서 request, response 가져오기
    const { request, response } = event.Records[0].cf;

    //쿼리스트링 가져오기
    const queryString = request.querystring;
    if(!queryString){
        console.log("querystring is empty");
        return response;
    }

    // uri 가져오기
    const uri = decodeURIComponent(request.uri);

    // 파일 확장자 가져오기
    const extension = uri.match(/(.*)\.(.*)/)[2].toLowerCase();
    console.log("extension", extension);

    // 펫돌이에서 지원하는 확장자가 아니면 원본 반환
    if(extension !== 'png' && extension !== 'jpg' && extension !== 'jpeg'){
        console.log(`${extension} extension is not supported`);
        return response;
    }

    // 쿼리스트링 파싱
    const width = Number(getQuerystring(queryString, "w")) || null;
    const height = Number(getQuerystring(queryString, "h")) || null;
    const fit = getQuerystring(queryString, "f");
    const quality = Number(getQuerystring(queryString, "q")) || null;

    console.log({ width, height, fit, quality});

    //s3 데이터 가져오기
    const s3BucketDomainName = request.origin.s3.domainName;
    let s3BucketName = s3BucketDomainName.replace(".s3.ap-northeast-2.amazonaws.com", "");
    s3BucketName = s3BucketName.replace(".s3.amazonaws.com", "");
    console.log("received s3 bukcet name :", s3BucketName);
    const s3Path = uri.substring(1);

    //S3에서 이미지 가져오기
    let s3Object = null;
    try{
        s3Object = await S3.send(
            new GetObjectCommand({
                Bucket: s3BucketName,
                Key: s3Path
            })
        );
        console.log("getting S3 Object is success");
    }catch (err){
        console.log("getting S3 Object is fail \n" +
            "bucket name :" + s3BucketName + ", path :" + s3Path + "\n" +
            "err :" + err);
        return err;
    }

    //이미지 리사이즈 수행
    const s3Uint8ArrayData = await s3Object.Body.transformToByteArray();
    let resizedImage = null;
    try{
        resizedImage = await Sharp(s3Uint8ArrayData)
            .resize({
                width: width,
                height: height,
                fit: fit
            })
            .toFormat(extension, {
                quality: quality
            })
            .toBuffer();
        console.log("resizing image is success");
    }catch (err) {
        console.log("resizing image is fail \n" +
            "bucket name :" + s3BucketName + ", path :" + s3Path + "\n" +
            "err :" + err);
        return err;
    }

    // Lambda@Edge에서 응답을 만드는 경우, 응답가능한 body에 크기제한이 존재    
    // base64 인코딩 텍스트로 반환하는 경우 1MB(1,048,576 byte)까지 가능
    const byteLengthOfResizedImage = Buffer.byteLength(resizedImage, 'base64');
    console.log('byte length of resized image :', byteLengthOfResizedImage);

    // 리사이징한 이미지 크기가 1MB 이상이면 원본 반환
    if (byteLengthOfResizedImage >= 1048576) {
        console.log("byte length of resized image >= 1048576");
        return response;
    }

    // response 수정
    response.status = 200;
    response.body = resizedImage.toString('base64');
    response.bodyEncoding = 'base64';

    return response;
};